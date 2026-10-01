import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import * as http from 'http';
import * as https from 'https';
import {
  isHtmlErrorResponse,
  isRewritableContentType,
  resolveTargetUrl,
  rewriteHostInHeaderValue,
  rewriteHostInText,
} from './proxy.utils';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

const STRIP_REQUEST_HEADERS = new Set([
  'accept-encoding',
  'forwarded',
  'via',
  'x-forwarded-host',
  'x-forwarded-server',
  'x-real-ip',
]);

@Injectable()
export class ProxyMiddleware implements NestMiddleware {
  private readonly logger = new Logger(ProxyMiddleware.name);
  private readonly target: URL;

  constructor(configService: ConfigService) {
    this.target = new URL(
      resolveTargetUrl(configService.get<string>('TARGET_HOST')),
    );
    this.logger.log(`Proxy target: ${this.target.origin}`);
  }

  use(req: Request, res: Response): void {
    const incomingPath = req.originalUrl || req.url;
    const targetUrl = new URL(incomingPath, this.target);
    const incomingHost = req.headers.host;
    const targetHost = targetUrl.host;
    const isHttps = targetUrl.protocol === 'https:';
    const requestImpl = isHttps ? https.request : http.request;

    const headers: http.OutgoingHttpHeaders = {};
    for (const [key, value] of Object.entries(req.headers)) {
      const headerName = key.toLowerCase();
      if (
        value === undefined ||
        HOP_BY_HOP_HEADERS.has(headerName) ||
        STRIP_REQUEST_HEADERS.has(headerName)
      ) {
        continue;
      }

      headers[key] = incomingHost
        ? rewriteHostInHeaderValue(value, incomingHost, targetHost)
        : value;
    }
    headers.host = targetHost;

    const proxyReq = requestImpl(
      {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method: req.method,
        headers,
        timeout: 120_000,
      },
      (proxyRes) => {
        const statusCode = proxyRes.statusCode ?? 502;
        const contentType = headerToString(proxyRes.headers['content-type']);
        const stripHtmlError = isHtmlErrorResponse(statusCode, contentType);

        res.statusCode = statusCode;

        for (const [key, value] of Object.entries(proxyRes.headers)) {
          const headerName = key.toLowerCase();
          if (
            value === undefined ||
            HOP_BY_HOP_HEADERS.has(headerName) ||
            headerName === 'content-length' ||
            (stripHtmlError &&
              (headerName === 'content-type' ||
                headerName === 'content-encoding'))
          ) {
            continue;
          }

          const rewritten = incomingHost
            ? rewriteHostInHeaderValue(value, incomingHost, targetHost)
            : value;

          if (rewritten !== undefined) {
            res.setHeader(key, rewritten);
          }
        }

        if (stripHtmlError) {
          res.setHeader('content-length', 0);
          proxyRes.resume();
          proxyRes.on('end', () => res.end());
          proxyRes.on('error', (err) => {
            this.logger.error(`Upstream response error: ${err.message}`);
            if (!res.writableEnded) {
              res.end();
            }
          });
          return;
        }

        const shouldRewriteBody =
          Boolean(incomingHost) && isRewritableContentType(contentType);

        if (!shouldRewriteBody) {
          proxyRes.pipe(res);
          return;
        }

        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          const raw = Buffer.concat(chunks);
          const rewritten = rewriteHostInText(
            raw.toString('utf8'),
            incomingHost as string,
            targetHost,
          );
          const body = Buffer.from(rewritten, 'utf8');
          res.setHeader('content-length', body.length);
          res.end(body);
        });
        proxyRes.on('error', (err) => {
          this.logger.error(`Upstream response error: ${err.message}`);
          if (!res.writableEnded) {
            res.end();
          }
        });
      },
    );

    proxyReq.on('timeout', () => {
      proxyReq.destroy(new Error('Proxy request timed out'));
    });

    proxyReq.on('error', (err) => {
      this.logger.error(`Proxy error: ${err.message}`);

      if (res.headersSent) {
        res.end();
        return;
      }

      res.status(502).json({
        statusCode: 502,
        message: 'Bad Gateway',
        error: err.message,
      });
    });

    req.pipe(proxyReq);
  }
}

function headerToString(
  value: string | string[] | number | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return Array.isArray(value) ? value.join(', ') : String(value);
}
