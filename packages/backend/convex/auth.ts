import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { DataModel } from "./_generated/dataModel";

/**
 * Email + password sign-in. The client calls signIn("password", { email, password,
 * flow: "signUp" | "signIn", name? }).
 * Google OAuth and magic-link email are not enabled yet: they need secrets
 * (AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET, and an email sender such as AUTH_RESEND_KEY).
 */
const PasswordProvider = Password<DataModel>({
  profile(params) {
    const email = String(params.email ?? "").trim().toLowerCase();
    if (!email) throw new Error("Email is required");
    const name = typeof params.name === "string" && params.name.trim() ? params.name.trim() : undefined;
    return name ? { email, name } : { email };
  },
  validatePasswordRequirements(password: string) {
    if (password.length < 8 || !/\d/.test(password) || !/[a-zA-Z]/.test(password)) {
      throw new Error("Password must be at least 8 characters and include a letter and a number");
    }
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [PasswordProvider],
});
