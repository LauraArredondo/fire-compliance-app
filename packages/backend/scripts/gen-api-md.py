import json, re, collections, subprocess
spec = json.load(open('/tmp/spec.json'))['functions']
ROLE = {"STAFF":"staff (owner/admin/office/engineer)","OFFICE":"office (owner/admin/office)","MANAGERS":"managers (owner/admin)","ANY":"any member incl. client_user"}
def ty(t):
    k=t.get('type')
    if k=='literal': return json.dumps(t['value'])
    if k=='union': return ' | '.join(ty(x) for x in t['value'])
    if k=='array': return ty(t['value'])+'[]'
    if k=='id': return f"Id<{t['tableName']}>"
    if k=='object':
        return '{ '+', '.join(f"{n}{'?' if not f['optional'] else ''}: {ty(f['fieldType'])}".replace('?:','::') if False else f"{n}{'?' if f['optional'] else ''}: {ty(f['fieldType'])}" for n,f in t['value'].items())+' }'
    if k=='record': return 'Record<string, '+ty(t['values']['fieldType'] if 'fieldType' in t.get('values',{}) else t.get('values',{}))+'>'
    return k
src = {}
def block(mod, name):
    if mod not in src:
        try: src[mod]=open(f'convex/{mod}.ts').read()
        except FileNotFoundError: src[mod]=''
    s=src[mod]; m=re.search(rf'(/\*\*((?:(?!\*/).)*)\*/\s*)?export const {name}\b', s, re.S)
    if not m: return '', ''
    rest=s[m.end():]; n=re.search(r'\nexport ', rest); body=rest[:n.start() if n else len(rest)]
    doc=re.sub(r'\s*\n\s*\*\s?',' ',(m.group(2) or '')).strip(' *')
    return body, doc
def calls(body):
    out=[]
    for m in re.finditer(r'\b(requireMember|loadForMember)\(', body):
        i=m.end(); d=1; j=i
        while d and j<len(body):
            d+= {'(':1,')':-1}.get(body[j],0); j+=1
        inner=body[i:j-1]
        parts=[];buf='';dd=0
        for ch in inner:
            if ch in '([{': dd+=1
            if ch in ')]}': dd-=1
            if ch==',' and dd==0: parts.append(buf.strip()); buf=''
            else: buf+=ch
        if buf.strip(): parts.append(buf.strip())
        idx=2 if m.group(1)=='requireMember' else 3
        out.append(parts[idx] if len(parts)>idx else 'ANY')
    return out
def who(mod,name,body,args):
    r=calls(body)
    order=['ANY','STAFF','OFFICE','MANAGERS']
    named=[x for x in r if x in order]
    if r:
        lit={'["owner", "admin", "office"]':'OFFICE','["owner", "admin"]':'MANAGERS','["owner", "admin", "office", "engineer"]':'STAFF'}
        r=[x.replace('U.','') for x in r]
        r=[lit.get(x, re.sub(r'^\[\.\.\.(\w+)\]$', r'\1', x)) for x in r]
        named=[x for x in r if x in order]
        best=min(named,key=order.index) if named else r[0]
        w=ROLE.get(best, best)
        if best=='ANY': w+=' (client_user scoped to own client/sites, read-only)'
        if len(set(r))>1: w+=' — further role checks inside'
        return w
    authd = 'getAuthUserId' in body or 'requireUser' in body or 'getCurrentUser' in body
    if 'token' in args: return ('PUBLIC (holder of quote link)' if mod=='quotes' else 'signed-in user holding the invite token') if authd else 'PUBLIC (holder of token)'
    if 'getAuthUserId' in body or 'requireUser' in body or 'getCurrentUser' in body: return 'any signed-in user'
    return 'PUBLIC'
groups=collections.defaultdict(list)
for f in spec:
    if f.get('visibility',{}).get('kind')!='public' or f['functionType'] not in ('Query','Mutation','Action'): continue
    path,name=f['identifier'].split(':'); mod=path[:-3]
    args=f['args']['value'] if f['args'] and f['args'].get('type')=='object' else {}
    body,doc=block(mod,name)
    a=', '.join(f"{n}{'?' if v['optional'] else ''}: {ty(v['fieldType'])}" for n,v in args.items())
    DISC=' | '.join(json.dumps(x) for x in ["fire_alarm","emergency_lighting","fire_extinguishers","sprinklers","fire_doors","dry_wet_risers","smoke_ventilation","gas_suppression","fire_risk_assessment","intruder_alarm","cctv","access_control","nurse_call","other"])
    a=a.replace(DISC,'Discipline')
    if len(a)>1500: a=a[:1500]+' …'
    groups[mod].append((name,f['functionType'].lower(),a,who(mod,name,body,args),doc))
ROLES_MD = """## Role scoping (server-enforced)

- **owner / admin / office**: everything in their org.
- **engineer**: only jobs they are assigned to (`jobs.assignedEngineerIds`, mirrored in `jobAssignments`) and the sites of those jobs (any job status).
  - `jobs:list` returns assigned jobs only; `jobs:get`, `visits:*`, `inspections:listForVisit`, job/visit attachments need the assignment -> `You're not assigned to this job`.
  - Site-scoped records (sites, assets, locations, defects, certificates, readings, site attachments) need an assigned job at that site -> `You're not assigned to a job at this site`; site lookups via `sites:get`, `assets:list`, `locations:listBySite`, `defects:openForSite`, `certificates:listBySite`, `assets:registerForSite`, `inspections:listForAsset`/`readingsForAsset` answer `Site not found`.
  - `sites:list` and `clients:list` return one full page (`isDone: true`) of assigned sites / their clients; `clients:*` give engineers `{_id, name}` only (`clients:get` on another client -> `You're not assigned to a job for this client`).
  - `certificates:list` and `defects:list` (org-wide) are filtered to assigned sites, so pages can be shorter than `numItems`; with `siteId` they refuse unassigned sites.
  - Refused with `Insufficient permissions`: `quotes:list/get/getPdf`, `invoices:*`, `serviceSchedules:list/get/dueSoon`, `reminders:*`, `certificates:reissue`, attachments on quotes.
  - `organizations:get` omits `bankDetails`, `quoteTerms`, `invoiceFooter`, `defaultTaxRate`, `jobAutomation`.
- **client_user** (portal): unchanged, plus `clients:get` now omits `notes`, `accountNumber`, `externalAccountingId`; `certificates:getPdf`/`listBySite` respect their granted sites.
"""
out=["# API reference — dev deployment elegant-echidna-735","","Generated from `npx convex function-spec` + source. Roles: owner, admin, office, engineer, client_user.",
"`Discipline` = fire_alarm | emergency_lighting | fire_extinguishers | sprinklers | fire_doors | dry_wet_risers | smoke_ventilation | gas_suppression | fire_risk_assessment | intruder_alarm | cctv | access_control | nurse_call | other.","All org-scoped functions take `orgId` and check membership via `requireMember`; client_user is read-only and limited to their client/granted sites. Errors are `ConvexError` with a user-facing message.","",
ROLES_MD,"## Counts by area","","| Area | Queries | Mutations | Actions | Total |","|---|---|---|---|---|"]
tot=collections.Counter()
for m in sorted(groups):
    c=collections.Counter(x[1] for x in groups[m]); tot.update(c)
    out.append(f"| {m} | {c['query']} | {c['mutation']} | {c['action']} | {len(groups[m])} |")
out.append(f"| **total** | {tot['query']} | {tot['mutation']} | {tot['action']} | {sum(tot.values())} |"); out.append("")
for m in sorted(groups):
    out.append(f"## {m}"); out.append("")
    for name,t,a,w,doc in sorted(groups[m]):
        out.append(f"### `{m}:{name}` ({t})")
        if doc: out.append(doc)
        out.append(f"- **Args:** `{{ {a} }}`" if a else "- **Args:** none")
        out.append(f"- **Who:** {w}"); out.append("")
open('API.md','w').write('\n'.join(out))
for m in sorted(groups): print(m, len(groups[m]))
print('TOTAL', sum(tot.values()), dict(tot))
