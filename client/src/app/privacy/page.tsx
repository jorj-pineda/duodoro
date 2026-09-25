import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy — Duodoro",
  description: "How Duodoro collects, uses, retains, and deletes data.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" effectiveDate="August 27, 2026">
      <section>
        <h2>1. Scope</h2>
        <p>
          This Policy explains how Duodoro, an independently operated shared
          focus timer, handles information when you visit, sign in, or focus
          with another person.
        </p>
      </section>

      <section>
        <h2>2. Information Duodoro handles</h2>
        <ul>
          <li>
            <strong>Sign-in data:</strong> your Google or Discord account ID,
            provider-confirmed email address, and available name or avatar
            metadata.
          </li>
          <li>
            <strong>Profile and social data:</strong> username, display name,
            avatar and world choices, presence, friendships, and invitations.
          </li>
          <li>
            <strong>Focus data:</strong> tasks, shared completion state,
            session participants, timer state, focus duration, world, and
            statistics derived from completed sessions.
          </li>
          <li>
            <strong>Companion access and email data:</strong> your companion
            access record, email address, and separate marketing preference.
          </li>
          <li>
            <strong>Technical data:</strong> authentication sessions, realtime
            connection data, browser storage used to keep your preferences and
            session context, and operational logs created by hosting providers.
          </li>
        </ul>
      </section>

      <section>
        <h2>3. How information is used</h2>
        <p>
          Information is used to authenticate you; run synchronized timers;
          display profiles, friends, tasks, and statistics; preserve sessions;
          prevent abuse; troubleshoot and secure the service; and respond to
          support or privacy requests. Duodoro does not sell personal
          information and does not currently use third-party advertising or
          behavioral analytics.
        </p>
      </section>

      <section>
        <h2>4. Sharing and processors</h2>
        <p>
          Session partners can see the profile, presence, task, and timer data
          needed for the shared session. Service providers process data to run
          Duodoro: Supabase provides authentication and database services,
          Vercel hosts the web app, and Render hosts the realtime server.
          Google or Discord processes information when you choose that sign-in
          provider. Information may also be disclosed when required by law or
          to protect users, the service, or legal rights.
        </p>
      </section>

      <section>
        <h2>5. Marketing choice</h2>
        <p>
          Marketing email is optional and is not required to use Duodoro or
          keep companion access. You can withdraw consent at any time from
          Privacy &amp; account. Any Duodoro marketing message will also provide
          a way to opt out. Service and security messages are not marketing.
        </p>
      </section>

      <section>
        <h2>6. Retention and deletion</h2>
        <p>
          Account-linked profile, social, task, focus-participant, companion
          access, and consent records are generally kept while your account
          exists. Choose Privacy &amp; account → Delete account to permanently
          remove your sign-in and linked account data, including a matching
          legacy waitlist address. This cannot be undone.
        </p>
        <p>
          A shared session record needed for another participant’s history may
          remain after deletion, but the link to your deleted identity is
          removed. A shared round still waiting to save is discarded for both
          participants. Hosting providers may retain short-lived backups, security
          records, and operational logs according to their own retention
          schedules or legal duties.
        </p>
      </section>

      <section>
        <h2>7. Your choices and requests</h2>
        <p>
          Profile controls let you correct your username, display name, avatar,
          and world. Privacy &amp; account lets you manage marketing consent and
          delete your account. To request access, correction, or a portable
          copy of account data—or if you cannot use those controls—email{" "}
          <a href="mailto:jorgepineda0310@gmail.com">
            jorgepineda0310@gmail.com
          </a>
          . Your location may give you additional privacy rights.
        </p>
      </section>

      <section>
        <h2>8. Security and international processing</h2>
        <p>
          Duodoro uses provider authentication, row-level database controls,
          encrypted network connections, and restricted server credentials.
          No online service can promise perfect security. Providers may process
          data in countries other than yours, subject to their safeguards and
          applicable law.
        </p>
      </section>

      <section>
        <h2>9. Children</h2>
        <p>
          Duodoro is not directed to children under 13 and does not knowingly
          collect their personal information. Contact the address below if you
          believe a child under 13 has provided information.
        </p>
      </section>

      <section>
        <h2>10. Changes and contact</h2>
        <p>
          Material changes will be posted here with a new effective date and,
          when appropriate, called out in the service. Questions and privacy
          requests can be sent to{" "}
          <a href="mailto:jorgepineda0310@gmail.com">
            jorgepineda0310@gmail.com
          </a>
          .
        </p>
      </section>
    </LegalPage>
  );
}
