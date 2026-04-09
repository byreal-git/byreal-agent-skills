/**
 * HTTP client for Byreal API
 */

import ky, { HTTPError, TimeoutError } from "ky";
import { API_BASE_URL, DEFAULTS, VERSION } from "../core/constants.js";
import { networkError, apiError } from "../core/errors.js";
import type { Result } from "../core/types.js";
import { ok, err } from "../core/types.js";
import type { ByrealError } from "../core/errors.js";

// ============================================
// Client Configuration
// ============================================

const client = ky.create({
  prefixUrl: API_BASE_URL,
  timeout: DEFAULTS.REQUEST_TIMEOUT_MS,
  headers: {
    "Content-Type": "application/json",
    "User-Agent": `byreal-cli/${VERSION}`,
  },
  hooks: {
    beforeRequest: [
      (request) => {
        if (process.env.DEBUG) {
          console.error(`[DEBUG] ${request.method} ${request.url}`);
        }
      },
    ],
  },
});

// ============================================
// Request Functions
// ============================================

export async function get<T>(
  endpoint: string,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<Result<T, ByrealError>> {
  try {
    // Filter out undefined params
    const searchParams = params
      ? (Object.fromEntries(
          Object.entries(params).filter(([, v]) => v !== undefined),
        ) as Record<string, string>)
      : undefined;

    const response = await client.get(endpoint.replace(/^\//, ""), {
      searchParams,
    });

    const data = await response.json<T>();
    return ok(data);
  } catch (error) {
    return err(await handleRequestError(error));
  }
}

export async function post<T>(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<Result<T, ByrealError>> {
  try {
    const response = await client.post(endpoint.replace(/^\//, ""), {
      json: body,
    });

    const data = await response.json<T>();
    return ok(data);
  } catch (error) {
    return err(await handleRequestError(error));
  }
}

// ============================================
// Error Handling
// ============================================

async function handleRequestError(error: unknown): Promise<ByrealError> {
  if (error instanceof HTTPError) {
    const status = error.response.status;
    const statusText = error.response.statusText;
    if (process.env.DEBUG) {
      try {
        const body = await error.response.text();
        console.error(`[DEBUG] Response body: ${body}`);
      } catch {
        /* ignore */
      }
    }
    return apiError(`${status} ${statusText}`, status);
  }

  if (error instanceof TimeoutError) {
    return networkError("Request timed out", {
      timeout_ms: DEFAULTS.REQUEST_TIMEOUT_MS,
    });
  }

  if (error instanceof Error) {
    // Network errors (ECONNREFUSED, etc.)
    if ("code" in error) {
      return networkError(error.message, {
        code: (error as NodeJS.ErrnoException).code,
      });
    }
    return networkError(error.message);
  }

  return networkError("Unknown error occurred");
}

// ============================================
// Exported Client
// ============================================

export const apiClient = {
  get,
  post,
};
