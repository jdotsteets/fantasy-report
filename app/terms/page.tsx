// =============================
// app/terms/page.tsx
// =============================
import type { Metadata } from "next";


export const metadata: Metadata = {
title: "Terms of Service | The Fantasy Report",
description:
"Terms of Service for The Fantasy Report explaining acceptable use, content, links, and disclaimers.",
robots: { index: true, follow: true },
alternates: { canonical: "https://www.thefantasyreport.com/terms" },
};


export default function TermsPage() {
return (
<main className="mx-auto max-w-3xl px-6 py-10 prose prose-zinc">
<h1>Terms of Service</h1>
<p><strong>Last Updated:</strong> September 25, 2025</p>


<p>
Welcome to <strong>The Fantasy Report</strong> ("we," "us," or "our"). By
accessing or using <a href="https://www.thefantasyreport.com">thefantasyreport.com</a>
(the "Site"), you agree to these Terms of Service (the "Terms"). If you do not
agree, do not use the Site.
</p>


<h2>1. Eligibility & Accounts</h2>
<p>
You must be at least 13 years old to use the Site. If you create an
account, you are responsible for safeguarding your credentials and for all
activity under your account.
</p>


<h2>2. Acceptable Use</h2>
<ul>
<li>Do not break the law or infringe intellectual property rights.</li>
<li>Do not attempt to hack, disrupt, or scrape the Site beyond any robots.txt allowances.</li>
<li>Do not post or transmit spam, malware, or harassing content.</li>
</ul>


<h2>3. Content & Intellectual Property</h2>
<p>
All content on the Site (including text, logos, graphics, and
compilations) is owned by us or our licensors and is protected by
applicable laws. You may view and share links to public pages for
personal, non‑commercial use. Any other use requires our prior written
permission.
</p>


<h2>4. Third‑Party Links & Sources</h2>
<p>
We link to and summarize third‑party articles and data. We do not control
or endorse third‑party sites and are not responsible for their content or
policies. Your interactions with third parties are solely between you and
them.
</p>


<h2>5. No Professional Advice</h2>
<p>
Content is provided for information and entertainment only and does not
constitute professional, financial, or gambling advice. Sports outcomes
are uncertain; you assume all risk from decisions you make based on the
content.
</p>


<h2>6. Disclaimer of Warranties</h2>
<p>
The Site is provided on an "AS IS" and "AS AVAILABLE" basis without warranties of any
kind, express or implied, including accuracy, reliability, or
availability.
</p>


<h2>7. Limitation of Liability</h2>
<p>
To the maximum extent permitted by law, we are not liable for any
indirect, incidental, special, consequential, or punitive damages, or any
loss of profits or data, arising from your use of the Site.
</p>


<h2>8. Indemnification</h2>
<p>
You agree to indemnify and hold us harmless from claims, damages, and
expenses arising from your breach of these Terms or misuse of the Site.
</p>


<h2>9. Changes</h2>
<p>
We may update these Terms at any time. The updated version will be
effective when posted with a revised "Last Updated" date.
</p>
</main>
)
}