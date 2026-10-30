import { canAccessWebPath as c, sectionsFor } from "../src/permissions.ts";
const cases: [string,string,boolean][] = [
 ["engineer","/app",true],["engineer","/app/jobs",true],["engineer","/app/jobs/abc",true],["engineer","/app/jobs/new",false],["engineer","/app/jobs/abc/edit",false],
 ["engineer","/app/invoices",false],["engineer","/app/invoices/x",false],["engineer","/app/quotes",false],["engineer","/app/team",false],["engineer","/app/settings",false],
 ["engineer","/app/schedules/x",false],["engineer","/app/clients",false],["engineer","/app/clients/x",false],["engineer","/app/sites",false],["engineer","/app/sites/x",true],
 ["engineer","/app/sites/new",false],["engineer","/app/sites/x/edit",false],["engineer","/app/assets/x",true],["engineer","/app/defects/new",true],["engineer","/app/certificates/new",true],["engineer","/app/profile",true],
 ["office","/app/invoices",true],["office","/app/settings",true],["office","/app/team",true],["office","/app/jobs/new",true],["admin","/app/whatever",true],["engineer","/app/whatever",false],
];
let bad = 0; for (const [r,p,e] of cases) if (c(r as any,p)!==e){bad++;console.log("FAIL",r,p,e)}
console.log(bad? "failures":"all", cases.length, "route checks passed");
for (const r of ["owner","admin","office","engineer"]) console.log(r, sectionsFor(r as any).map(s=>s.label).join(", "));
if (bad) process.exit(1);
