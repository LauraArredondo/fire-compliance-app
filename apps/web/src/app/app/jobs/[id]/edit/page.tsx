"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api, type Doc, type Id } from "@/lib/api";
import { Loading, Notice, PageHeader } from "@/components/ui";
import { JobForm } from "@/components/forms/JobForm";

export default function EditJobPage() {
  const { id } = useParams<{ id: Id<"jobs"> }>();
  const job = useQuery(api.jobs.get, { jobId: id });
  if (!job) return <Loading />;
  const locked = ["completed", "invoiced", "cancelled"].includes(job.status);
  return (
    <>
      <PageHeader title={`Edit ${job.jobNumber}`} back={{ href: `/app/jobs/${id}`, label: job.jobNumber }} />
      {locked ? <Notice>This job is {job.status} and can no longer be edited.</Notice> : <JobForm job={job as Doc<"jobs">} />}
    </>
  );
}
