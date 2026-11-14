import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'How to reach the Animellion team.',
  alternates: { canonical: '/contact' },
};

export default function ContactPage() {
  const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
  return (
    <article className="prose">
      <h1>Contact</h1>
      <p>Questions, a correct answer that was not accepted, a bug, or a privacy or rights request? Get in touch.</p>
      {email ? (
        <p>
          Email: <a href={`mailto:${email}`}>{email}</a>
        </p>
      ) : (
        <p className="notice warn">
          A contact address has not been configured yet. Site operator: set <code>NEXT_PUBLIC_CONTACT_EMAIL</code>.
        </p>
      )}
      <h2>Reporting an answer</h2>
      <p>
        Tell us the date of the game, the prompt and the answer you typed. Unrecognised answers are also logged
        automatically and reviewed.
      </p>
    </article>
  );
}
