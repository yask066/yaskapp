import type { FastifyInstance } from 'fastify';
import type { DatabaseError } from 'pg';

import {
  createUser,
  findUserByEmailOrUsername,
  markUserSeen
} from './auth.repository.js';
import type { AuthenticatedUser } from './auth.repository.js';
import { hashPassword, verifyPassword } from './password.js';

const tokenExpiresIn = '7d';

export class ConflictError extends Error {}

export class AuthenticationError extends Error {}

type RegisterInput = {
  email: string;
  username: string;
  password: string;
  countryCode: string;
  displayName?: string;
};

type LoginInput = {
  login: string;
  password: string;
};

type AuthResponse = {
  user: AuthenticatedUser;
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
};

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isUniqueViolation(error: unknown): error is DatabaseError {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
}

function signAccessToken(app: FastifyInstance, user: AuthenticatedUser) {
  return app.jwt.sign(
    {
      sub: user.id,
      username: user.username
    },
    {
      expiresIn: tokenExpiresIn
    }
  );
}

function authResponse(app: FastifyInstance, user: AuthenticatedUser): AuthResponse {
  return {
    user,
    accessToken: signAccessToken(app, user),
    tokenType: 'Bearer',
    expiresIn: tokenExpiresIn
  };
}

export async function registerUser(app: FastifyInstance, input: RegisterInput) {
  const email = normalizeEmail(input.email);
  const username = normalizeUsername(input.username);
  const passwordHash = await hashPassword(input.password);

  try {
    const user = await createUser({
      email,
      username,
      passwordHash,
      countryCode: input.countryCode,
      displayName: input.displayName?.trim() || username
    });

    return authResponse(app, user);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('Email or username is already taken.');
    }

    throw error;
  }
}

export async function signInUser(app: FastifyInstance, input: LoginInput) {
  const login = input.login.trim().toLowerCase();
  const account = await findUserByEmailOrUsername(login);

  if (!account) {
    throw new AuthenticationError('Invalid login or password.');
  }

  if (account.user.status !== 'active') {
    throw new AuthenticationError('Account is not active.');
  }

  const passwordMatches = await verifyPassword(input.password, account.passwordHash);

  if (!passwordMatches) {
    throw new AuthenticationError('Invalid login or password.');
  }

  await markUserSeen(account.user.id);

  return authResponse(app, account.user);
}
