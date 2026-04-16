import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get('name');

  if (!name) {
    return NextResponse.json({ error: 'Missing name param' }, { status: 400 });
  }

  // Simple auth guard for production only
  if (process.env.NODE_ENV === 'production') {
    const token = searchParams.get('token');
    if (token !== process.env.DEBUG_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
  }

  const tenant = db
    .prepare('SELECT name, generation_status, LENGTH(html_content) AS html_length, updated_at FROM tenants WHERE name = ?')
    .get(name) as { name: string; generation_status: string; html_length: number; updated_at: string } | undefined;

  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  return NextResponse.json(tenant);
}