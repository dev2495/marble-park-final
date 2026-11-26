import { IsNumber, IsOptional, Matches, Max, MaxLength, Min, ValidateIf, ValidationOptions } from 'class-validator';
import { applyDecorators } from '@nestjs/common';

/**
 * Small input rules for the riskiest GraphQL inputs. They only reject values
 * that could never be right (absurd length, letters in a phone number, a
 * negative amount). Empty values stay allowed wherever the field is optional,
 * so nothing that works today starts failing.
 */

const skipWhenEmpty = ValidateIf((_o, value) => value !== undefined && value !== null && value !== '');

/** Free text with a length cap. */
export const TextLimit = (max: number, options?: ValidationOptions) =>
  applyDecorators(IsOptional(), MaxLength(max, { message: `Must be at most ${max} characters`, ...options }));

/** Email address, optional. Empty is allowed. */
export const OptionalEmail = () =>
  applyDecorators(
    skipWhenEmpty,
    MaxLength(160, { message: 'Email is too long' }),
    Matches(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/, { message: 'Enter a valid email address' }),
  );

/** Phone number, optional: at least 6 digits, up to 24 characters, no angle brackets. */
export const OptionalPhone = () =>
  applyDecorators(
    skipWhenEmpty,
    MaxLength(24, { message: 'Phone number is too long' }),
    Matches(/^(?=(?:\D*\d){6,})[^<>]{6,24}$/, { message: 'Enter a valid phone number (at least 6 digits)' }),
  );

/** Money amount in rupees: a real number, not negative, below 100 crore. */
export const MoneyAmount = () =>
  applyDecorators(
    IsOptional(),
    IsNumber({ allowNaN: false, allowInfinity: false }, { message: 'Enter a valid amount' }),
    Min(0, { message: 'Amount cannot be negative' }),
    Max(1_000_000_000, { message: 'Amount is too large' }),
  );

/** Quantity: a real number, not negative, below one million. */
export const Quantity = () =>
  applyDecorators(
    IsOptional(),
    IsNumber({ allowNaN: false, allowInfinity: false }, { message: 'Enter a valid quantity' }),
    Min(0, { message: 'Quantity cannot be negative' }),
    Max(1_000_000, { message: 'Quantity is too large' }),
  );
