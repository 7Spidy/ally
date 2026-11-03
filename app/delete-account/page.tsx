import type { Metadata } from "next";
import Link from "next/link";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Request Account & Data Deletion — Ally",
  description: "Request the deletion of your Ally account and all associated personal data operated by redream.in.",
};

export default function DeleteAccountPage() {
  const mailtoSubject = encodeURIComponent("Account & Data Deletion Request - Ally");
  const mailtoBody = encodeURIComponent(
    "Hello Ally Privacy Team,\n\nI would like to request the permanent deletion of my Ally account and all associated data.\n\nMy registered email address is: [INSERT YOUR REGISTERED EMAIL]\n\nThank you."
  );
  const mailtoHref = `mailto:privacy@redream.in?subject=${mailtoSubject}&body=${mailtoBody}`;

  return (
    <main id="deleteAccountPage" className={styles.page}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <Link href="/" className={styles.backLink}>
            <svg viewBox="0 0 24 24">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to Ally
          </Link>
          <h1 className={styles.title}>Account &amp; Data Deletion</h1>
          <p className={styles.meta}>
            <strong>Application:</strong> Ally &nbsp;|&nbsp; <strong>Developer:</strong> redream.in &nbsp;|&nbsp; <strong>Last Updated:</strong> November 1, 2026
          </p>
        </header>

        <div className={styles.summaryBox}>
          <p>
            At <strong>redream.in</strong>, we believe you should always maintain full ownership and control of your personal data. 
            In compliance with Google Play&apos;s Data Safety policies and international privacy regulations (GDPR, CCPA, DPDP), this page explains how you can permanently delete your <strong>Ally</strong> account and all associated data, whether using the application or submitting a direct web request without accessing the app.
          </p>
        </div>

        <section className={styles.cardsGrid}>
          <div className={styles.optionCard}>
            <div>
              <span className={`${styles.cardBadge} ${styles.cardBadgeFast}`}>Instant Deletion</span>
              <h2 className={styles.cardTitle}>Option 1: In-App Self Service</h2>
              <p className={styles.cardDescription}>
                If you have the Ally app installed or can log into the web app, you can delete your account instantly with immediate effect:
              </p>
              <ol className={styles.cardSteps}>
                <li>Open <strong>Ally</strong> on your mobile device or web browser.</li>
                <li>Tap the <strong>Settings</strong> icon (top right corner).</li>
                <li>Select <strong>Privacy &amp; Data</strong>.</li>
                <li>Tap <strong>Delete Account</strong> and confirm your choice.</li>
              </ol>
            </div>
            <Link href="/settings/privacy" className={styles.cardBtn}>
              Go to Privacy Settings
            </Link>
          </div>

          <div className={styles.optionCard}>
            <div>
              <span className={styles.cardBadge}>Web / Email Request</span>
              <h2 className={styles.cardTitle}>Option 2: Direct Deletion Request</h2>
              <p className={styles.cardDescription}>
                If you have uninstalled the app, lost access to your device, or cannot log in, our privacy team can manually process your deletion request:
              </p>
              <ol className={styles.cardSteps}>
                <li>Send an email to <strong>privacy@redream.in</strong>.</li>
                <li>Use the subject line <em>&quot;Account &amp; Data Deletion Request&quot;</em>.</li>
                <li>Send the request from your registered email address.</li>
                <li>We will verify ownership and process the deletion within 30 days.</li>
              </ol>
            </div>
            <a href={mailtoHref} className={`${styles.cardBtn} ${styles.cardBtnSecondary}`}>
              Email Deletion Request
            </a>
          </div>
        </section>

        <article className={styles.content}>
          <h2>1. Data That Will Be Permanently Deleted</h2>
          <p>When your account is deleted (either in-app or via manual request), the following data is permanently erased from our production databases:</p>
          <ul>
            <li><strong>Account &amp; Authentication Records:</strong> Your user ID, registered email address, hashed authentication credentials, and session tokens.</li>
            <li><strong>Profile Information:</strong> Your chosen display name, age, gender identity, questionnaire responses, archetype match ratings, and preferences.</li>
            <li><strong>Conversational History:</strong> All chat messages, replies, message edit history, jumbo reactions, and conversational tombstones.</li>
            <li><strong>Memory Vault (Context Distillation):</strong> All distilled personal facts, conversational context, and summaries stored for long-term memory continuity.</li>
            <li><strong>Relationship &amp; Progression Data:</strong> Trust progression points, relationship levels, and unlocked milestone configurations.</li>
            <li><strong>Notification &amp; Device Tokens:</strong> Push notification tokens and device association keys.</li>
          </ul>

          <h2>2. Data Retention &amp; Policy Exceptions</h2>
          <p>We do not retain your personal conversations or profile information after deletion has taken place:</p>
          <ul>
            <li><strong>Immediate Production Purge:</strong> Once an in-app deletion is triggered, your user record and all foreign-key dependent rows are immediately removed via cascading database deletion.</li>
            <li><strong>Transient Server Logs:</strong> Standard technical and security access logs (which do not contain message contents) are retained for a maximum of 30 days strictly for fraud prevention, server diagnostics, and DDoS mitigation before being automatically overwritten.</li>
            <li><strong>Legal &amp; Regulatory Obligations:</strong> If required by applicable law or a valid legal process, certain transaction or audit metadata may be retained for the minimum statutory period required by jurisdiction.</li>
          </ul>

          <h2>3. Anonymous Guest Accounts</h2>
          <p>
            If you used Ally as a guest without creating an email-backed account, your data is tied only to a temporary anonymous identifier stored locally on your device. You can erase this data at any time by clearing the app&apos;s storage/cache in your Android system settings, or by clearing your browser site data.
          </p>

          <h2>4. Timeline for Request Processing</h2>
          <ul>
            <li><strong>In-App Deletion:</strong> Completed <strong>immediately</strong> upon user confirmation.</li>
            <li><strong>Email / Web Deletion:</strong> Acknowledged within <strong>48–72 hours</strong> and completely purged from all active systems within <strong>30 calendar days</strong>.</li>
          </ul>

          <h2>5. Ready-to-Use Email Request Template</h2>
          <p>If you prefer to email us directly, you may copy and paste the following template:</p>
          <div className={styles.emailTemplateBox}>
            <strong>To:</strong> privacy@redream.in<br />
            <strong>Subject:</strong> Account &amp; Data Deletion Request - Ally<br />
            <br />
            Hello redream.in Privacy Team,<br />
            <br />
            I am requesting the permanent deletion of my Ally account and all associated personal data.<br />
            <br />
            - App Name: Ally<br />
            - Registered Email: [Your Email Address Here]<br />
            - Reason (Optional): [Optional feedback]<br />
            <br />
            Please confirm once my data and account have been deleted.<br />
            <br />
            Thank you.
          </div>

          <h2>6. Contact &amp; Privacy Inquiries</h2>
          <p>For any questions or concerns regarding our data handling or deletion procedures, you can contact us at:</p>
          <ul>
            <li><strong>Company:</strong> redream.in</li>
            <li><strong>Privacy Email:</strong> <a href="mailto:privacy@redream.in">privacy@redream.in</a></li>
            <li><strong>Support Email:</strong> <a href="mailto:support@redream.in">support@redream.in</a></li>
            <li><strong>Website:</strong> <a href="https://ally.redream.in" target="_blank" rel="noopener noreferrer">https://ally.redream.in</a></li>
          </ul>
        </article>

        <footer className={styles.footer}>
          <div className={styles.footerLinks}>
            <Link href="/privacy">Privacy Policy</Link>
            <span>&bull;</span>
            <Link href="/delete-account">Delete Account</Link>
            <span>&bull;</span>
            <Link href="/">Ally Home</Link>
          </div>
          <div>
            &copy; {new Date().getFullYear()} redream.in. All rights reserved.
          </div>
        </footer>
      </div>
    </main>
  );
}
