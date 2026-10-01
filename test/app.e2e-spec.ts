import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import * as http from 'http';
import { AddressInfo } from 'net';
import { AppModule } from './../src/app.module';

describe('Proxy (e2e)', () => {
  let app: INestApplication;
  let upstream: http.Server;
  let lastRequest: {
    method?: string;
    url?: string;
    host?: string;
    origin?: string;
    referer?: string;
    authorization?: string;
    body: Buffer;
  };

  beforeAll(async () => {
    lastRequest = { body: Buffer.alloc(0) };

    upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];

      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        lastRequest = {
          method: req.method,
          url: req.url,
          host: req.headers.host,
          origin: req.headers.origin,
          referer: req.headers.referer,
          authorization: req.headers.authorization,
          body: Buffer.concat(chunks),
        };

        const isError = req.url?.startsWith('/error');
        const shouldLeakProxyHost = req.url?.includes('leak=1');
        res.writeHead(isError ? 400 : 200, {
          'Content-Type': 'application/json',
          'X-Upstream-Header': 'keep-me',
          Location: shouldLeakProxyHost
            ? 'https://proc.com/redirect'
            : `http://${req.headers.host}/ok`,
        });
        res.end(
          JSON.stringify({
            ok: !isError,
            message: isError ? 'upstream error' : 'ok',
            url: shouldLeakProxyHost ? 'https://proc.com/pay' : undefined,
          }),
        );
      });
    });

    await new Promise<void>((resolve) =>
      upstream.listen(0, '127.0.0.1', resolve),
    );

    const { port } = upstream.address() as AddressInfo;
    process.env.TARGET_HOST = `http://127.0.0.1:${port}`;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve, reject) =>
      upstream.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it('forwards path, query, method and host', async () => {
    await request(app.getHttpServer())
      .get('/v1/deposit/rub?foo=bar')
      .set('Authorization', 'Bearer test')
      .expect(200)
      .expect({ ok: true, message: 'ok' })
      .expect('X-Upstream-Header', 'keep-me');

    expect(lastRequest.method).toBe('GET');
    expect(lastRequest.url).toBe('/v1/deposit/rub?foo=bar');
    expect(lastRequest.host).toMatch(/^127\.0\.0\.1:\d+$/);
    expect(lastRequest.authorization).toBe('Bearer test');
  });

  it('forwards request body', async () => {
    await request(app.getHttpServer())
      .post('/v1/deposit/rub')
      .set('Content-Type', 'application/json')
      .send({ amount: 100 })
      .expect(200);

    expect(JSON.parse(lastRequest.body.toString())).toEqual({ amount: 100 });
  });

  it('forwards upstream errors as-is', async () => {
    await request(app.getHttpServer())
      .get('/error/fail')
      .expect(400)
      .expect({ ok: false, message: 'upstream error' })
      .expect('X-Upstream-Header', 'keep-me');
  });

  it('does not leak the proxy host to upstream or back to the caller', async () => {
    const proxyHost = 'proc.com';

    const response = await request(app.getHttpServer())
      .post('/v1/deposit/rub?leak=1')
      .set('Host', proxyHost)
      .set('Origin', `https://${proxyHost}`)
      .set('Referer', `https://${proxyHost}/form`)
      .set('Content-Type', 'application/json')
      .send({ amount: 100 })
      .expect(200);

    expect(lastRequest.host).not.toBe(proxyHost);
    expect(lastRequest.origin).toBe(`https://${lastRequest.host}`);
    expect(lastRequest.referer).toBe(`https://${lastRequest.host}/form`);

    expect(response.headers.location).not.toContain(proxyHost);
    expect(JSON.stringify(response.body)).not.toContain(proxyHost);
    expect(response.headers.location).toBe(
      `https://${lastRequest.host}/redirect`,
    );
    expect(response.body).toEqual({
      ok: true,
      message: 'ok',
      url: `https://${lastRequest.host}/pay`,
    });
  });
});
