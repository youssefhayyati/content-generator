import { Fragment, type ReactNode } from 'react'
import { Link } from '../../lib/router'

/*
 * The three legal pages, written from what FlowAI actually does: what it stores, which services it
 * sends work to, which cookies it sets. Keep them in step with the product when that changes.
 */

/** Where privacy and legal questions go. Null until there's a real inbox: the pages say how to act without it. */
export const CONTACT: string | null = null

export const UPDATED = '10 October 2026'

export type DocId = 'privacy' | 'terms' | 'cookies'
export type Doc = { id: DocId; path: string; label: string; title: [string, string]; lead: string; sections: Array<{ id: string; title: string; body: ReactNode }> }

const Strong = ({ children }: { children: ReactNode }) => <strong className="font-medium text-fg">{children}</strong>

function Contact() {
  return CONTACT ? (
    <p>
      Questions, requests or complaints: write to{' '}
      <a href={`mailto:${CONTACT}`} className="text-fg underline decoration-line-2 underline-offset-4 hover:decoration-current">
        {CONTACT}
      </a>
      . We answer within 30 days.
    </p>
  ) : (
    <p>
      A dedicated address for privacy and legal requests is being set up and will be listed here. Until then, everything you can ask us
      to do with your data, you can also do yourself: change your details in <Strong>Settings</Strong>, remove accounts in{' '}
      <Strong>Accounts</Strong>, and remove everything with <Strong>Settings → Delete account</Strong>.
    </p>
  )
}

export const DOCS: Record<DocId, Doc> = {
  privacy: {
    id: 'privacy',
    path: '/privacy',
    label: 'Privacy',
    title: ['Privacy', 'policy.'],
    lead: 'What FlowAI keeps about you, why, who else sees it, and how to take it back. No advertising, no selling, no tracking.',
    sections: [
      {
        id: 'scope',
        title: 'What this covers',
        body: (
          <p>
            FlowAI is a studio for social content: it helps you write, make, schedule and publish posts across your accounts. This policy covers
            this website and the FlowAI app, and everything you put into them.
          </p>
        ),
      },
      {
        id: 'collect',
        title: 'What we collect',
        body: (
          <>
            <ul>
              <li>
                <Strong>Your account.</Strong> Name, email address, password (stored only as a hash), time zone and profile picture. If you sign
                in with Google or GitHub, we also keep that account’s ID and the basic profile it shares.
              </li>
              <li>
                <Strong>What you make.</Strong> Posts, captions, campaigns and their briefs, studio projects, flows and automation rules, and the
                media you upload or generate: pictures, videos, voices and music.
              </li>
              <li>
                <Strong>Your social accounts.</Strong> The handles and platforms you add, and what you teach each one: instructions, examples,
                its posting history and editorial profile.
              </li>
              <li>
                <Strong>Material from platforms.</Strong> Comments brought into your inbox, posts you choose to repost, and the trend searches
                you run.
              </li>
              <li>
                <Strong>Publishing records.</Strong> Phones you register, and the steps and screenshots the publishing agent records as proof a
                post went live.
              </li>
              <li>
                <Strong>Running the service.</Strong> How much AI each task used, and the technical logs every web service keeps: IP address,
                browser, times and errors.
              </li>
            </ul>
          </>
        ),
      },
      {
        id: 'use',
        title: 'How we use it',
        body: (
          <>
            <p>Only to run FlowAI for you:</p>
            <ul>
              <li>to write, generate, schedule and publish what you ask for;</li>
              <li>to keep your account secure and sign you in;</li>
              <li>to send the emails you need, such as address confirmation, password resets and alerts when a post fails;</li>
              <li>to show you your own usage and analytics, and to find and fix problems.</li>
            </ul>
            <p>
              We don’t sell your data, we don’t use it for advertising, and we don’t use your content to train AI models of our own.
            </p>
          </>
        ),
      },
      {
        id: 'ai',
        title: 'AI providers',
        body: (
          <>
            <p>
              To write or make something, FlowAI sends the prompt and the material that task needs to an AI model. Depending on the model chosen
              for the task, that is one of: <Strong>Anthropic</Strong> (Claude), <Strong>Google</Strong> (Gemini), <Strong>Groq</Strong>,{' '}
              <Strong>OpenRouter</Strong>, <Strong>Ollama</Strong> or <Strong>Higgsfield</Strong> for pictures and video. Some models, and the
              voice and music tools, run on FlowAI’s own servers and send nothing out.
            </p>
            <p>Each provider handles what it receives under its own terms and privacy policy. We send only what the task needs.</p>
          </>
        ),
      },
      {
        id: 'sharing',
        title: 'Who else sees it',
        body: (
          <ul>
            <li>
              <Strong>The platforms you publish to</Strong>, once you publish. From then on, that post is governed by the platform’s own terms.
            </li>
            <li>
              <Strong>AI providers</Strong>, as described above.
            </li>
            <li>
              <Strong>The services that keep FlowAI running</Strong>, such as hosting and email delivery, only as far as they need to.
            </li>
            <li>
              <Strong>Authorities</Strong>, when the law requires it.
            </li>
          </ul>
        ),
      },
      {
        id: 'keeping',
        title: 'How long we keep it',
        body: (
          <p>
            For as long as your account exists. Deleting your account removes it, every post and your posting times. Copies in backups can
            outlive that for a while, until those backups are replaced.
          </p>
        ),
      },
      {
        id: 'security',
        title: 'Security',
        body: (
          <p>
            Passwords are stored as hashes, never as text. Access to the servers is limited to the people who run FlowAI. Nothing goes out on
            your accounts without your approval or a rule you set up yourself.
          </p>
        ),
      },
      {
        id: 'rights',
        title: 'Your choices',
        body: (
          <ul>
            <li>
              <Strong>Correct</Strong> your name, email and time zone in Settings.
            </li>
            <li>
              <Strong>Remove</Strong> any social account in Accounts.
            </li>
            <li>
              <Strong>Delete</Strong> everything with Settings → Delete account.
            </li>
            <li>
              <Strong>Ask</Strong> for a copy of your data, or about anything in this policy, using the contact below.
            </li>
          </ul>
        ),
      },
      {
        id: 'children',
        title: 'Children',
        body: <p>FlowAI isn’t meant for anyone under 16, and we don’t knowingly keep their data.</p>,
      },
      {
        id: 'changes',
        title: 'Changes',
        body: <p>When this policy changes, the date at the top changes with it. If a change matters, we’ll tell you in the app or by email first.</p>,
      },
      { id: 'contact', title: 'Contact', body: <Contact /> },
    ],
  },

  terms: {
    id: 'terms',
    path: '/terms',
    label: 'Terms',
    title: ['Terms of', 'service.'],
    lead: 'The deal between you and FlowAI, in plain words: what you can expect from us, and what we expect from you.',
    sections: [
      {
        id: 'agreement',
        title: 'The agreement',
        body: <p>By creating an account or using FlowAI, you accept these terms. If you don’t, please don’t use the service.</p>,
      },
      {
        id: 'account',
        title: 'Your account',
        body: (
          <p>
            You need to be at least 16. Give accurate details, keep your password to yourself, and tell us if you think someone else got in.
            You’re responsible for what happens under your account.
          </p>
        ),
      },
      {
        id: 'content',
        title: 'Your content',
        body: (
          <>
            <p>
              What you upload and make with FlowAI stays yours. You allow us to store it, process it and send it where it needs to go (to AI
              providers to work on it, and to the platforms you publish to) only so we can run the service for you.
            </p>
            <p>You need the rights to everything you upload, and the author’s permission for anything you repost.</p>
          </>
        ),
      },
      {
        id: 'ai',
        title: 'AI output',
        body: (
          <p>
            Generated text, pictures, video and audio can be wrong, resemble someone else’s work, or simply be unsuitable. FlowAI gives you
            review and approval steps; use them. What goes out on your accounts is your responsibility, so look at it before it does.
          </p>
        ),
      },
      {
        id: 'platforms',
        title: 'Social platforms',
        body: (
          <p>
            Every platform you publish to has its own rules, and you need to follow them. Some platforms may count automated posting from a
            phone against their terms: only use it on accounts you’re allowed to automate. We aren’t responsible for what a platform does to
            your account.
          </p>
        ),
      },
      {
        id: 'use',
        title: 'Fair use',
        body: (
          <>
            <p>Don’t use FlowAI to:</p>
            <ul>
              <li>publish anything illegal, hateful, harassing or deceptive, or impersonate someone;</li>
              <li>send spam or fake engagement;</li>
              <li>break into, overload or reverse-engineer the service, or get around its limits;</li>
              <li>scrape it, or resell it without our agreement.</li>
            </ul>
          </>
        ),
      },
      {
        id: 'service',
        title: 'The service',
        body: (
          <p>
            We keep improving FlowAI, so features change. We work to keep it running, but can’t promise it will always be available or free of
            errors, and generation depends on outside AI providers being up.
          </p>
        ),
      },
      {
        id: 'ending',
        title: 'Ending',
        body: (
          <p>
            You can delete your account at any time in Settings. We may suspend or close accounts that break these terms, and will tell you why
            unless the law stops us.
          </p>
        ),
      },
      {
        id: 'liability',
        title: 'Liability',
        body: (
          <p>
            FlowAI is provided as it is. As far as the law allows, we aren’t liable for indirect losses, lost profits or data, or for what is
            published from your accounts. Nothing here limits liability that the law doesn’t allow to be limited.
          </p>
        ),
      },
      {
        id: 'changes',
        title: 'Changes',
        body: <p>If these terms change, the date at the top changes too, and we’ll tell you about anything significant before it applies.</p>,
      },
      { id: 'contact', title: 'Contact', body: <Contact /> },
    ],
  },

  cookies: {
    id: 'cookies',
    path: '/cookies',
    label: 'Cookies',
    title: ['Cookie', 'policy.'],
    lead: 'FlowAI only stores what it needs to work. No advertising or analytics cookies, no third-party scripts; even the fonts come from our own server.',
    sections: [
      {
        id: 'cookies',
        title: 'Cookies we set',
        body: (
          <Table
            rows={[
              ['flowai-session', 'Keeps you signed in while you use FlowAI.', 'Until you sign out, or 2 hours idle'],
              ['XSRF-TOKEN', 'Proves a form was sent from FlowAI itself, not another site.', 'Same as the session'],
              ['remember_web_…', 'Keeps you signed in after the browser closes, when you ticked “Remember me” or used Google or GitHub.', 'Until you sign out'],
            ]}
          />
        ),
      },
      {
        id: 'storage',
        title: 'Stored on your device',
        body: (
          <>
            <p>A few preferences live in your browser’s local storage. They never leave your device.</p>
            <Table
              rows={[
                ['flowai-palette', 'The colour palette you picked.', 'Until you clear it'],
                ['flowai.cursor', 'Whether you use FlowAI’s cursor or your system’s.', 'Until you clear it'],
                ['flowai.sidebar.rail, flowai.sidebar.folded', 'How you left the dashboard sidebar.', 'Until you clear it'],
                ['flowai.assistant.conversation', 'The assistant conversation you had open, to pick it up again.', 'Until you clear it'],
              ]}
            />
          </>
        ),
      },
      {
        id: 'choices',
        title: 'Your choices',
        body: (
          <p>
            You can block or delete cookies in your browser’s settings, but you won’t be able to sign in without the session cookie. Clearing
            this site’s data resets the preferences above.
          </p>
        ),
      },
      {
        id: 'more',
        title: 'More',
        body: (
          <p>
            How we handle the rest of your data is in the{' '}
            <Link to="/privacy" className="text-fg underline decoration-line-2 underline-offset-4 hover:decoration-current">
              privacy policy
            </Link>
            .
          </p>
        ),
      },
      { id: 'contact', title: 'Contact', body: <Contact /> },
    ],
  },
}

function Table({ rows }: { rows: Array<[name: string, purpose: string, lasts: string]> }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(0,0.9fr)] gap-6 border-b border-line bg-panel px-5 py-3 font-mono text-[10.5px] uppercase tracking-[0.16em] text-dim sm:grid">
        <span>Name</span>
        <span>What it’s for</span>
        <span>How long</span>
      </div>
      {rows.map(([name, purpose, lasts]) => (
        <div key={name} className="grid gap-1.5 border-b border-line px-5 py-4 last:border-b-0 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(0,0.9fr)] sm:gap-6">
          <code className="font-mono text-[12.5px] text-fg">
            {/* Long names wrap after a dot or comma, never mid-word. */}
            {name.split(/(?<=[.,])/).map((part, i) => (
              <Fragment key={i}>
                {part}
                <wbr />
              </Fragment>
            ))}
          </code>
          <span className="text-[14.5px] leading-snug text-muted">{purpose}</span>
          <span className="text-[13px] text-dim">{lasts}</span>
        </div>
      ))}
    </div>
  )
}
