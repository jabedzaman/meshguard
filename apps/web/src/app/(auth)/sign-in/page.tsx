import { Suspense } from "react";
import { AuthForm } from "~/components/auth-form";

export default function SignInPage() {
  return (
    <Suspense>
      <AuthForm mode="sign-in" />
    </Suspense>
  );
}
