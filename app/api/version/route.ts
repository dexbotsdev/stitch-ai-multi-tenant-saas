import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    version: process.env.npm_package_version || 'unknown',
    commit: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || 'unknown',
    buildTime: process.env.BUILD_TIME || new Date().toISOString(),
    environment: process.env.NODE_ENV || 'unknown',
  });
}