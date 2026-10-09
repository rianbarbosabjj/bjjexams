"use strict";
// Gate 9.4C5: REAL membership/enrollment domain decisions with synthetic actors.
// No emulator, Firebase initialization, production/staging traffic or payments.
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {
  isActiveMembership, canManageOrganization, canApplyOfficialExam,
  toCanonicalMembershipView
}=require("../functions/src/auth/organization-membership");
const {
  membershipMatchesCourse,assertCanSelfEnrollFreeCourse,
  resolveCourseEntitlement,enrollmentDocumentId,CourseEnrollmentDomainError
}=require("../functions/src/courses/course-enrollment-domain");
const ROOT=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(ROOT,p),"utf8");
const actor="synthetic-actor-A";
const otherActor="synthetic-actor-B";
const orgA="synthetic-academy-A",orgB="synthetic-academy-B";
const course={id:"synthetic-course-B",status:"published",visibility:"organization",
  organizationId:orgB,isPaid:false,priceCents:0};
const membership=(organizationId,userId,status="active",role="student")=>({
  organizacao_id:organizationId,usuario_id:userId,status,papel:role
});
const belongsToA=membership(orgA,actor);
const belongsToB=membership(orgB,actor);
const foreignIdentity=membership(orgB,otherActor);
assert.equal(isActiveMembership(belongsToA),true);
assert.equal(membershipMatchesCourse(course,belongsToA,actor),false);
assert.equal(membershipMatchesCourse(course,belongsToB,actor),true);
assert.equal(membershipMatchesCourse(course,foreignIdentity,actor),false);
assert.equal(membershipMatchesCourse(course,membership(orgB,actor,"pending"),actor),false);
assert.equal(membershipMatchesCourse(course,membership(orgB,actor,"suspended"),actor),false);
assert.equal(membershipMatchesCourse(course,membership(orgB,actor,"ended"),actor),false);
assert.equal(membershipMatchesCourse(course,membership(orgB,actor,"rejected"),actor),false);
assert.equal(membershipMatchesCourse(course,{},actor),false);
assert.equal(canManageOrganization(belongsToA),false);
assert.equal(canApplyOfficialExam(belongsToA),false);
assert.equal(canManageOrganization(membership(orgA,actor,"active","owner")),true);
assert.equal(canApplyOfficialExam(membership(orgA,actor,"active","instructor")),false);
assert.equal(canApplyOfficialExam({
  ...membership(orgA,actor,"active","instructor"),pode_aplicar_exames:true
}),true);
assert.equal(canManageOrganization(membership(orgA,actor,"suspended","owner")),false);
assert.equal(toCanonicalMembershipView(belongsToA).organizationId,orgA);
assert.equal(toCanonicalMembershipView(belongsToA).userId,actor);

const denyEnrollment=(m,reason)=>assert.throws(
  ()=>assertCanSelfEnrollFreeCourse({course,membership:m,userId:actor}),
  e=>e instanceof CourseEnrollmentDomainError&&e.code===reason
);
denyEnrollment(belongsToA,"ORGANIZATION_MEMBERSHIP_REQUIRED");
denyEnrollment(foreignIdentity,"ORGANIZATION_MEMBERSHIP_REQUIRED");
denyEnrollment(membership(orgB,actor,"pending"),"ORGANIZATION_MEMBERSHIP_REQUIRED");
denyEnrollment(null,"ORGANIZATION_MEMBERSHIP_REQUIRED");
assert.equal(assertCanSelfEnrollFreeCourse({
  course,membership:belongsToB,userId:actor
}),true);
denyEnrollment({ ...belongsToB,organizacao_id:orgA },
  "ORGANIZATION_MEMBERSHIP_REQUIRED");
assert.throws(()=>assertCanSelfEnrollFreeCourse({
  course:{...course,isPaid:true,priceCents:100},
  membership:belongsToB,userId:actor
}),e=>e.code==="PAYMENT_REQUIRED");
assert.throws(()=>assertCanSelfEnrollFreeCourse({
  course:{...course,visibility:"private"},
  membership:belongsToB,userId:actor
}),e=>e.code==="PRIVATE_COURSE_REQUIRES_GRANT");

const enrollment={
  courseId:course.id,userId:actor,source:"free",orderId:null,
  status:"active",progressPercent:0
};
const authorize=(e,m,c=course)=>resolveCourseEntitlement({
  courseId:course.id,userId:actor,course:c,enrollment:e,membership:m
});
assert.deepEqual(authorize(enrollment,belongsToA),{
  granted:false,reason:"ORGANIZATION_MEMBERSHIP_REQUIRED"
});
assert.deepEqual(authorize(enrollment,foreignIdentity),{
  granted:false,reason:"ORGANIZATION_MEMBERSHIP_REQUIRED"
});
assert.deepEqual(authorize(enrollment,null),{
  granted:false,reason:"ORGANIZATION_MEMBERSHIP_REQUIRED"
});
assert.deepEqual(authorize(enrollment,membership(orgB,actor,"suspended")),{
  granted:false,reason:"ORGANIZATION_MEMBERSHIP_REQUIRED"
});
assert.deepEqual(authorize({...enrollment,userId:otherActor},belongsToB),{
  granted:false,reason:"ENROLLMENT_IDENTITY_MISMATCH"
});
assert.deepEqual(authorize({...enrollment,courseId:"foreign-course"},belongsToB),{
  granted:false,reason:"ENROLLMENT_IDENTITY_MISMATCH"
});
assert.deepEqual(authorize({...enrollment,status:"refunded"},belongsToB),{
  granted:false,reason:"ENROLLMENT_INACTIVE"
});
assert.equal(authorize(enrollment,belongsToB).granted,true);
assert.deepEqual(authorize(null,belongsToB),{
  granted:false,reason:"ENROLLMENT_REQUIRED"
});
assert.deepEqual(authorize({...enrollment,source:"free"},belongsToB,{
  ...course,isPaid:true,priceCents:100
}),{granted:false,reason:"PAYMENT_ENTITLEMENT_REQUIRED"});
const first=enrollmentDocumentId(course.id,actor);
const second=enrollmentDocumentId(course.id,otherActor);
assert.match(first,/^[0-9a-f]{64}$/);
assert.notEqual(first,second);
assert.ok(!first.includes(actor) && !first.includes(orgA) && !first.includes(orgB));

const callable=read("functions/src/courses/course-enrollment-functions.js");
assert.ok(callable.includes("request.auth?.uid"));
assert.ok(callable.includes("enrollmentDocumentId(courseId, uid)"));
assert.ok(callable.includes("membershipMatchesCourse(course, membership, userId)"));
assert.ok(callable.includes(".where('usuario_id', '==', uid)"));
assert.ok(!callable.includes("request.data?.userId"));
const invitations=read("functions/src/auth/organization-invitations.js");
assert.ok(invitations.includes("vinculo.organizacao_id ==="));
assert.ok(invitations.includes("canManageOrganization("));
const workflow=read(".github/workflows/marco8-rc-regression.yml");
assert.ok(workflow.includes("node tests/marco9-cross-organization-denials-v1_2.test.js"));
const doc=read("docs/architecture/MARCO_9_4C5_9_5B2_ISOLATION_PRIVACY.md");
for(const marker of ["9.4C5","9.5B2","IDOR","Auth","STRIDE","NO_GO",
  "NO_DEPLOY","RETENTION_UNAPPROVED","Cloud Logging"])
  assert.ok(doc.includes(marker),"missing doc marker "+marker);
console.log("MARCO9_4C5_CROSS_ORGANIZATION_DENIALS=PASSED");
console.log("MARCO9_4C5_FOREIGN_USER_ENROLLMENT=BLOCKED");
console.log("MARCO9_4C5_SUSPENDED_AND_PENDING_MEMBERSHIP=BLOCKED");
console.log("MARCO9_4C5_PAID_AND_PRIVATE_SELF_ENROLL=BLOCKED");
console.log("MARCO9_4C5_AUTH_UID_QUERY_BINDING=STATICALLY_VERIFIED");
console.log("MARCO9_4C5_STAGING_PENTEST=NOT_RUN");
console.log("MARCO9_GATE_9_4C5_ORG_ISOLATION=PASSED");
