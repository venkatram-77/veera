import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";
import { config } from "./config";
import { db, DEV_USER } from "./db";
import type { User } from "./types";

const COOKIE_NAME = "veera_session";
const secret = new TextEncoder().encode(config.authSecret);

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function getSessionUser(): Promise<User | null> {
  if (!config.authEnabled) return DEV_USER;
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    if (!payload.sub || !payload.email || !payload.name) return null;
    return { id: String(payload.sub), email: String(payload.email), name: String(payload.name) };
  } catch {
    return null;
  }
}

export async function setSessionCookie(user: User): Promise<void> {
  const token = await new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}

export function findUserByEmail(email: string): (User & { password_hash: string }) | undefined {
  return db()
    .prepare("SELECT id, email, name, password_hash FROM users WHERE email = ?")
    .get(email.toLowerCase()) as (User & { password_hash: string }) | undefined;
}

export function createUser(email: string, name: string, password: string): User {
  const user: User = {
    id: crypto.randomUUID(),
    email: email.toLowerCase(),
    name: name.trim() || email.split("@")[0],
  };
  db()
    .prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(user.id, user.email, user.name, hashPassword(password), new Date().toISOString());
  return user;
}
