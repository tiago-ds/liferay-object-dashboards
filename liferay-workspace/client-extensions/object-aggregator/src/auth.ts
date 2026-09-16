import { lookupConfig, lxcConfig } from "@rotty3000/config-node";
import cors from "cors";
import type { NextFunction, Request, Response } from "express";
import { verify } from "jsonwebtoken";
import jwkToPem from "jwk-to-pem";
import fetch from "node-fetch";

import { OAUTH_USER_AGENT_ERC } from "./constants.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The caller's bearer token, forwarded verbatim to Liferay. */
      liferayToken?: string;
      /** The calling user's id, or undefined when the JWT did not carry one. */
      liferayUserId?: string;
    }
  }
}

const READY_PATH = "/ready";

/**
 * lxcConfig.oauthApplication() returns UNDEFINED for an unknown ERC — it does
 * not throw. Without this check the first property access fails as an opaque
 * "cannot read properties of undefined", which is a miserable thing to debug on
 * a fresh install where the likeliest cause is simply a renamed application.
 * Fail here instead, and print the ERCs Liferay actually injected.
 */
function requireOAuthApplication(erc: string) {
  const app = lxcConfig.oauthApplication(erc);
  if (app) return app;

  const known = lookupConfig("liferay.oauth.application.external.reference.codes");
  throw new Error(
    `No OAuth2 application with external reference code "${erc}". ` +
      `Liferay injected: ${JSON.stringify(known) || "(nothing — is the LXC metadata mounted?)"}. ` +
      `Check Control Panel > Security > OAuth2 Administration and update OAUTH_USER_AGENT_ERC in src/constants.ts.`
  );
}

const userAgentApp = requireOAuthApplication(OAUTH_USER_AGENT_ERC);
const dxpOrigin = `${lxcConfig.dxpProtocol()}://${lxcConfig.dxpMainDomain()}`;
const jwksURL = `${dxpOrigin}${userAgentApp.jwksUri()}`;

// Only the DXP's own domains may call this service from a browser.
const allowedOrigins = (lxcConfig.dxpDomains() ?? []).map(
  (domain) => `${lxcConfig.dxpProtocol()}://${domain}`
);

const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    callback(null, !origin || allowedOrigins.includes(origin));
  },
};

/** The health probe must answer before any CORS/auth negotiation. */
export function corsWithReady(req: Request, res: Response, next: NextFunction) {
  if (req.path === READY_PATH) return next();
  return cors(corsOptions)(req, res, next);
}

/**
 * Verifies the bearer token the widget got from
 * Liferay.OAuth2Client.FromUserAgentApplication(). The signature is checked
 * against Liferay's JWKS and the client_id must be our user-agent application,
 * so only our widget — on behalf of a signed-in user — can reach /aggregate.
 */
export async function liferayJWT(req: Request, res: Response, next: NextFunction) {
  if (req.path === READY_PATH) return next();

  const [, bearerToken] = (req.headers.authorization ?? "").split("Bearer ");
  if (!bearerToken) {
    res.status(401).send("Missing authorization header.");
    return;
  }

  try {
    const jwksResponse = await fetch(jwksURL);
    if (!jwksResponse.ok) {
      res.status(401).send("Could not verify authorization.");
      return;
    }

    const jwks = (await jwksResponse.json()) as { keys: jwkToPem.JWK[] };
    const decoded = verify(bearerToken, jwkToPem(jwks.keys[0]), {
      algorithms: ["RS256"],
    }) as { client_id?: string; sub?: string; user_id?: string; userId?: string };

    const expected = userAgentApp.clientId().replaceAll(" ", "");
    if (decoded.client_id?.replaceAll(" ", "") !== expected) {
      res.status(401).send("Invalid authorization.");
      return;
    }

    // Keep the caller's token: every Liferay read this request makes is made
    // AS THEM, so Liferay applies their permissions instead of ours.
    req.liferayToken = bearerToken;

    // Used to partition the cache. Claim naming varies by Liferay version, so
    // try the likely ones — and when none is present the caller is treated as
    // uncacheable rather than sharing a bucket with someone else.
    req.liferayUserId = decoded.sub ?? decoded.user_id ?? decoded.userId;

    next();
  } catch {
    res.status(401).send("Invalid authorization.");
  }
}
