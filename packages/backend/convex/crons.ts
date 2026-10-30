import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Hourly; the handler only plans/sends at 07:00 Europe/London, so it stays correct across GMT/BST.
crons.hourly("compliance reminders", { minuteUTC: 0 }, internal.reminders.hourlyTick, {});

export default crons;
