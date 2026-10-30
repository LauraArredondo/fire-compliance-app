/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as assetTypes from "../assetTypes.js";
import type * as assets from "../assets.js";
import type * as attachments from "../attachments.js";
import type * as auth from "../auth.js";
import type * as certificatePdf from "../certificatePdf.js";
import type * as certificateTypes from "../certificateTypes.js";
import type * as certificates from "../certificates.js";
import type * as checklistTemplates from "../checklistTemplates.js";
import type * as clients from "../clients.js";
import type * as commercialDocs from "../commercialDocs.js";
import type * as commercialPdf from "../commercialPdf.js";
import type * as crons from "../crons.js";
import type * as defects from "../defects.js";
import type * as emails from "../emails.js";
import type * as http from "../http.js";
import type * as inspections from "../inspections.js";
import type * as invoices from "../invoices.js";
import type * as jobs from "../jobs.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_autoJobs from "../lib/autoJobs.js";
import type * as lib_docPdf from "../lib/docPdf.js";
import type * as lib_emailTemplates from "../lib/emailTemplates.js";
import type * as lib_labels from "../lib/labels.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_notify from "../lib/notify.js";
import type * as lib_overdueInvoices from "../lib/overdueInvoices.js";
import type * as lib_pdfKit from "../lib/pdfKit.js";
import type * as lib_qualifications from "../lib/qualifications.js";
import type * as lib_reminderConfig from "../lib/reminderConfig.js";
import type * as lib_schedules from "../lib/schedules.js";
import type * as lib_tokens from "../lib/tokens.js";
import type * as lib_util from "../lib/util.js";
import type * as lib_verification from "../lib/verification.js";
import type * as lib_verifyPage from "../lib/verifyPage.js";
import type * as locations from "../locations.js";
import type * as organizations from "../organizations.js";
import type * as portal from "../portal.js";
import type * as qualifications from "../qualifications.js";
import type * as quotes from "../quotes.js";
import type * as reminders from "../reminders.js";
import type * as serviceSchedules from "../serviceSchedules.js";
import type * as sites from "../sites.js";
import type * as team from "../team.js";
import type * as testing from "../testing.js";
import type * as users from "../users.js";
import type * as visits from "../visits.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  assetTypes: typeof assetTypes;
  assets: typeof assets;
  attachments: typeof attachments;
  auth: typeof auth;
  certificatePdf: typeof certificatePdf;
  certificateTypes: typeof certificateTypes;
  certificates: typeof certificates;
  checklistTemplates: typeof checklistTemplates;
  clients: typeof clients;
  commercialDocs: typeof commercialDocs;
  commercialPdf: typeof commercialPdf;
  crons: typeof crons;
  defects: typeof defects;
  emails: typeof emails;
  http: typeof http;
  inspections: typeof inspections;
  invoices: typeof invoices;
  jobs: typeof jobs;
  "lib/auth": typeof lib_auth;
  "lib/autoJobs": typeof lib_autoJobs;
  "lib/docPdf": typeof lib_docPdf;
  "lib/emailTemplates": typeof lib_emailTemplates;
  "lib/labels": typeof lib_labels;
  "lib/money": typeof lib_money;
  "lib/notify": typeof lib_notify;
  "lib/overdueInvoices": typeof lib_overdueInvoices;
  "lib/pdfKit": typeof lib_pdfKit;
  "lib/qualifications": typeof lib_qualifications;
  "lib/reminderConfig": typeof lib_reminderConfig;
  "lib/schedules": typeof lib_schedules;
  "lib/tokens": typeof lib_tokens;
  "lib/util": typeof lib_util;
  "lib/verification": typeof lib_verification;
  "lib/verifyPage": typeof lib_verifyPage;
  locations: typeof locations;
  organizations: typeof organizations;
  portal: typeof portal;
  qualifications: typeof qualifications;
  quotes: typeof quotes;
  reminders: typeof reminders;
  serviceSchedules: typeof serviceSchedules;
  sites: typeof sites;
  team: typeof team;
  testing: typeof testing;
  users: typeof users;
  visits: typeof visits;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
