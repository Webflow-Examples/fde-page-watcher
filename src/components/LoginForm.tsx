import Image from "next/image";
import webflowSocialLogo from "../../public/webflow-social.png";

const ERRORS: Record<string, string> = {
  access: "This email has not been invited to Page Watch.",
  configuration: "Login is temporarily unavailable. Please try again shortly.",
  handoff: "That login attempt expired or could not be verified. Please try again.",
};

export function LoginForm({ startHref, error, signedOut = false }: { startHref: string; error?: string; signedOut?: boolean }) {

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-heading">
        <div className="login-brand">
          <Image src={webflowSocialLogo} alt="Webflow" width={36} height={36} priority unoptimized />
          <span>Page Watch</span>
        </div>
        <div className="login-copy">
          <div className="login-eyebrow">Secure access</div>
          <h1 id="login-heading">Log in to Page Watch</h1>
          <p>Continue to the secure email-code login. Use the email address that was invited to Page Watch.</p>
        </div>
        <a className="login-primary-action" href={startHref}>Continue with email</a>
        {signedOut && <p className="login-message" role="status">You’re signed out.</p>}
        {error && <p className="login-error" role="alert">{ERRORS[error] ?? ERRORS.handoff}</p>}
      </section>
    </main>
  );
}
