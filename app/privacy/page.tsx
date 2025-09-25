// =============================
// app/privacy/page.tsx
// =============================
import type { Metadata as PrivacyMetadata } from "next";

export const metadata: PrivacyMetadata = {
  title: "Privacy Policy | The Fantasy Report",
  description:
    "Privacy Policy explaining what data The Fantasy Report collects, how it is used, and your choices.",
  robots: { index: true, follow: true },
  alternates: { canonical: "https://thefantasyreport.com/privacy" },
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10 prose prose-zinc">
      <h1>Privacy Policy</h1>
      <p><strong>Last Updated:</strong> September 25, 2025</p>

      <p>
        This Privacy Policy explains how <strong>The Fantasy Report</strong> ("we," "us," or
        "our") collects, uses, and shares information when you use
        <a href="https://thefantasyreport.com" className="ml-1">thefantasyreport.com</a> (the "Site").
      </p>

      <h2>Information We Collect</h2>
      <ul>
        <li>
          <strong>Site Logs & Analytics:</strong> IP address, device/browser info,
          pages visited, and referring URLs collected via standard logs and analytics
          tools (e.g., privacy‑friendly analytics or your chosen provider).
        </li>
        <li>
          <strong>Cookies:</strong> Small files used for session management,
          preferences, and analytics. See “Cookies & Tracking.”
        </li>
        <li>
          <strong>Voluntary Submissions:</strong> If you contact us or subscribe to updates,
          we collect the info you provide (e.g., email address and message).
        </li>
      </ul>

      <h2>How We Use Information</h2>
      <ul>
        <li>Operate, maintain, and improve the Site and its features.</li>
        <li>Measure content performance and detect/prevent abuse.</li>
        <li>Respond to inquiries and provide support.</li>
        <li>Send service or content updates you request (you can opt out any time).</li>
      </ul>

      <h2>Cookies & Tracking</h2>
      <p>
        We may use cookies, local storage, or similar technologies for core
        functionality and analytics. You can control cookies via your browser
        settings. Disabling cookies may affect certain features.
      </p>

      <h2>Analytics & Advertising Partners</h2>
      <p>
        If we use third‑party analytics or ad partners, they may set cookies or
        collect limited information in order to provide measurement or
        advertising services. Refer to those partners’ notices for details and
        opt‑out options.
      </p>

      <h2>Data Sharing</h2>
      <ul>
        <li>Service providers that help us run the Site (hosting, analytics, email).</li>
        <li>Legal or safety reasons when required by law or to protect rights.</li>
        <li>Business transfers in connection with a merger, sale, or reorganization.</li>
        <li>We do not sell personal information.
        </li>
      </ul>

      <h2>Data Retention</h2>
      <p>
        We retain information only as long as necessary for the purposes above or
        as required by law, then delete or anonymize it.
      </p>

      <h2>Your Choices</h2>
      <ul>
        <li>Opt out of non‑essential emails via the unsubscribe link.</li>
        <li>Adjust cookie settings in your browser.</li>
        <li>Contact us to access, correct, or delete information you provided.</li>
      </ul>

      <h2>Region‑Specific Rights</h2>
      <p>
        Depending on your location, you may have additional rights (e.g., GDPR in the EEA/UK, CCPA/CPRA in California), such as
        access, deletion, correction, and portability. To exercise these rights,
        contact us at the email below. We will verify your request consistent with
        applicable law.
      </p>

      <h2>Children’s Privacy</h2>
      <p>
        The Site is not directed to children under 13, and we do not knowingly
        collect personal information from children under 13.
      </p>

      <h2>Security</h2>
      <p>
        We use reasonable safeguards to protect information. However, no method
        of transmission or storage is 100% secure.
      </p>

      <h2>Changes to this Policy</h2>
      <p>
        We may update this Policy occasionally. The updated version will be
        posted here with a new “Last Updated” date.
      </p>

      <h2>Contact Us</h2>
      <p>
        Email <a href="mailto:contact@thefantasyreport.com">contact@thefantasyreport.com</a> with privacy questions or requests.
      </p>
    </main>
  );
}
