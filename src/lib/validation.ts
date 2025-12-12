import { z } from "zod";
import type { Context } from "hono";

/**
 * Input validation schemas for API parameters.
 * Prevents injection attacks and enforces reasonable limits.
 */

// Pacticipant/Consumer/Provider names: alphanumeric, dots, hyphens, underscores
export const nameSchema = z
  .string()
  .min(1, "Name cannot be empty")
  .max(255, "Name exceeds 255 characters")
  .regex(
    /^[a-zA-Z0-9._-]+$/,
    "Name can only contain letters, numbers, dots, hyphens, and underscores"
  );

// Version strings: flexible format (semver, git SHA, dates, etc.)
export const versionSchema = z
  .string()
  .min(1, "Version cannot be empty")
  .max(255, "Version exceeds 255 characters");

// Tag names: similar to names but slightly more permissive
export const tagSchema = z
  .string()
  .min(1, "Tag cannot be empty")
  .max(255, "Tag exceeds 255 characters")
  .regex(
    /^[a-zA-Z0-9._-]+$/,
    "Tag can only contain letters, numbers, dots, hyphens, and underscores"
  );

// Branch names: similar to tags
export const branchSchema = z
  .string()
  .min(1, "Branch cannot be empty")
  .max(255, "Branch exceeds 255 characters")
  .regex(
    /^[a-zA-Z0-9._/-]+$/,
    "Branch can only contain letters, numbers, dots, hyphens, underscores, and slashes"
  );

// SHA-256 content hashes: exactly 64 hex characters
export const shaSchema = z
  .string()
  .length(64, "SHA must be exactly 64 characters")
  .regex(/^[a-f0-9]+$/i, "SHA must be a valid hexadecimal string");

// Positive integer IDs (string input, string output for consistency)
export const idSchema = z
  .string()
  .regex(/^\d+$/, "ID must be a positive integer")
  .refine((val) => parseInt(val, 10) > 0, "ID must be greater than 0");

/**
 * Parse an ID string to number.
 * Call after validating with idSchema.
 */
export function parseId(idString: string): number {
  return parseInt(idString, 10);
}

// Environment names
export const environmentNameSchema = z
  .string()
  .min(1, "Environment name cannot be empty")
  .max(100, "Environment name exceeds 100 characters")
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    "Environment name can only contain letters, numbers, hyphens, and underscores"
  );

/**
 * Validate a parameter and return a 400 error response if invalid.
 * Returns the validated value if valid, or null and sends error response if invalid.
 */
export function validateParam<T>(
  c: Context,
  schema: z.ZodSchema<T>,
  value: string | undefined,
  paramName: string
): { valid: true; value: T } | { valid: false; response: Response } {
  const result = schema.safeParse(value);

  if (!result.success) {
    const errorMessage = result.error.errors[0]?.message || "Invalid input";
    return {
      valid: false,
      response: c.json(
        {
          error: "Bad Request",
          message: `Invalid ${paramName}: ${errorMessage}`,
        },
        400
      ) as unknown as Response,
    };
  }

  return { valid: true, value: result.data };
}

/**
 * Validate multiple parameters at once.
 * Returns all validated values or the first error response.
 */
export function validateParams(
  c: Context,
  validations: Array<{
    schema: z.ZodSchema;
    value: string | undefined;
    name: string;
  }>
): { valid: true; values: unknown[] } | { valid: false; response: Response } {
  const values: unknown[] = [];

  for (const { schema, value, name } of validations) {
    const result = validateParam(c, schema, value, name);
    if (!result.valid) {
      return result;
    }
    values.push(result.value);
  }

  return { valid: true, values };
}
