import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import { getSessionUserId } from '@/lib/auth';
import { TenantCreateSchema } from '@/lib/schemas';

function toDefaultTitle(name: string): string {
  return name
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

// ─────────────────────────────────────────────
// /api/tenants — CRUD for tenant management
// ─────────────────────────────────────────────

export async function GET() {
  try {
    const userId = getSessionUserId();
    const tenants = db
      .prepare(
        `SELECT t.id, t.name, t.title, t.description, t.generation_status, t.version,
                t.html_content, t.last_prompt, t.stitch_project_id, t.created_at, t.updated_at,
                j.started_at, j.current_phase
         FROM tenants t
         LEFT JOIN (
           SELECT tenant_id, started_at, current_phase, 
                  ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at DESC) as rn
           FROM stitch_jobs
         ) j ON t.id = j.tenant_id AND j.rn = 1
         WHERE t.user_id = ?
         ORDER BY t.created_at DESC`
      )
      .all(userId);
    return NextResponse.json(tenants);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch tenants' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const json = await request.json();
    const userId = getSessionUserId();

    // 1. Enforce Data Integrity
    const parsed = TenantCreateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    
    const { name, title, description } = parsed.data;
    const normalizedName = name.toLowerCase().trim();
    const normalizedTitle = title?.trim() || toDefaultTitle(normalizedName) || normalizedName;

    db.prepare(`INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)`).run(userId, 'demo@example.com', 'Demo User');

    const id = uuidv4();
    const stmt = db.prepare('INSERT INTO tenants (id, user_id, name, title, description) VALUES (?, ?, ?, ?, ?)');
    stmt.run(id, userId, normalizedName, normalizedTitle, description);

    return NextResponse.json(
      { id, name: normalizedName, title: normalizedTitle, description, generation_status: 'idle', version: 1 },
      { status: 201 }
    );
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return NextResponse.json({ error: 'Subdomain already exists' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to create tenant' }, { status: 500 });
  }
}
