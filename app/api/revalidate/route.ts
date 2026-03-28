import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Verify secret to prevent unauthorized revalidation
    const authHeader = request.headers.get('authorization');
    const secret = process.env.REVALIDATE_SECRET || process.env.CRON_SECRET;
    
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Revalidate homepage
    revalidatePath('/', 'page');
    
    return NextResponse.json({ 
      revalidated: true, 
      timestamp: new Date().toISOString(),
      message: 'Homepage cache cleared'
    });
  } catch (error) {
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  // Allow GET for testing (still requires auth)
  return POST(request);
}
