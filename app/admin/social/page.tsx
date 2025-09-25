import AdminSocialQueue from "./AdminSocialQueue";
import { dbQueryRows } from "@/lib/db";


// Mirror v_social_queue columns you created
export type SocialQueueRow = {
id: number; // social_drafts.id
article_id: number;
platform: "x" | "threads" | "tiktok" | "reels" | "shorts";
status: "draft" | "approved" | "scheduled" | "published" | "failed";
hook: string;
body: string;
cta: string | null;
media_url: string | null;
scheduled_for: string | null; // timestamptz → ISO string
created_at: string;
updated_at: string;
// joined article fields
article_title: string | null;
article_url: string | null; // coalesce(canonical,url)
raw_url: string | null;
canonical_url: string | null;
published_at: string | null;
discovered_at: string | null;
primary_topic: string | null;
static_type: string | null;
is_player_page: boolean | null;
week: number | null;
sport: string | null;
domain: string | null;
source_id: number | null;
source_name: string | null;
};


export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;


async function getQueue(): Promise<SocialQueueRow[]> {
const rows = await dbQueryRows<SocialQueueRow>(
`select * from v_social_queue order by status, scheduled_for nulls last, created_at desc limit 200`
);
return rows;
}


export default async function Page() {
const rows = await getQueue();
return <AdminSocialQueue rows={rows} />;
}