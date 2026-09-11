# Modelo de Dados — BJJ Exams v1.2

## Convenções

- IDs gerados no servidor sempre que a entidade não for naturalmente identificada por UID.
- Dinheiro em centavos inteiros.
- Percentuais em basis points (bps).
- Datas como Firestore Timestamp.
- `createdAt`, `updatedAt`, `createdBy` em entidades administrativas.
- `status` explícito no lugar de combinações de booleanos.

---

## 1. users/{uid}

```js
{
  displayName,
  email,
  photoURL,
  phone,
  status: 'active' | 'suspended' | 'archived',
  profileCompleted: true,
  createdAt,
  updatedAt
}
```

Não duplicar papéis de organização neste documento.

---

## 2. organizations/{organizationId}

```js
{
  name,
  type: 'academy' | 'team',
  status: 'active' | 'suspended' | 'archived',
  contact: { email, phone },
  address: { city, state, country },
  legacySourceId: null,
  createdAt,
  updatedAt,
  createdBy
}
```

---

## 3. organization_memberships/{membershipId}

```js
{
  organizationId,
  userId,
  role: 'owner' | 'manager' | 'instructor' | 'student',
  status: 'pending' | 'active' | 'rejected' | 'suspended' | 'ended',
  isPrimary: false,
  requestedBy,
  approvedBy,
  requestedAt,
  approvedAt,
  endedAt
}
```

Invariante recomendada: não permitir dois vínculos ativos equivalentes `organizationId + userId + role`.

---

## 4. courses/{courseId}

```js
{
  title,
  description,
  ownerType: 'platform' | 'user' | 'organization',
  ownerId,
  instructorIds: [],
  visibility: 'platform' | 'organization' | 'private',
  organizationId: null,
  status: 'draft' | 'review' | 'published' | 'suspended' | 'archived',
  isPaid: true,
  priceCents,
  currency: 'BRL',
  financialRuleId,
  publishedAt,
  createdAt,
  updatedAt
}
```

Para `visibility='organization'`, `organizationId` é obrigatório.

### Conteúdo

Sugestão:

`courses/{courseId}/modules/{moduleId}`

`courses/{courseId}/modules/{moduleId}/lessons/{lessonId}`

O cliente nunca deve receber conteúdo pago sem entitlement válido.

---

## 5. enrollments/{enrollmentId}

```js
{
  courseId,
  userId,
  source: 'free' | 'order' | 'admin_grant',
  orderId: null,
  status: 'active' | 'completed' | 'cancelled' | 'refunded',
  progressPercent,
  startedAt,
  completedAt,
  createdAt
}
```

Invariante: uma matrícula ativa por `courseId + userId`.

---

## 6. exam_templates/{templateId}

Define faixa, banco, quantidade de questões, nota mínima e regras de prova.

```js
{
  name,
  targetBelt,
  status: 'draft' | 'active' | 'archived',
  questionPoolId,
  questionCount,
  passingScoreBps,
  timeLimitMinutes,
  version,
  createdAt,
  updatedAt
}
```

---

## 7. exam_sessions/{sessionId}

```js
{
  organizationId,
  responsibleInstructorId,
  templateId,
  scheduledAt,
  status: 'draft' | 'candidates_selected' | 'awaiting_payment' | 'ready' | 'in_progress' | 'completed' | 'cancelled' | 'archived',
  priceCents,
  financialRuleId,
  createdBy,
  createdAt,
  updatedAt
}
```

---

## 8. exam_registrations/{registrationId}

```js
{
  sessionId,
  organizationId,
  studentId,
  instructorId,
  currentBelt,
  targetBelt,
  membershipId,
  status: 'selected' | 'awaiting_payment' | 'paid' | 'authorized' | 'started' | 'submitted' | 'passed' | 'failed' | 'certified' | 'cancelled',
  orderId,
  attemptId,
  resultId,
  certificateId,
  selectedAt,
  updatedAt
}
```

A criação exige membership ativo de aluno e permissão do professor na mesma organização.

---

## 9. exam_attempts/{attemptId}

```js
{
  registrationId,
  studentId,
  templateVersion,
  questionSnapshotIds: [],
  startedAt,
  submittedAt,
  status: 'in_progress' | 'submitted' | 'invalidated',
  scoreBps,
  passed
}
```

Gabaritos permanecem apenas em estruturas de backend/admin.

---

## 10. certificates/{certificateId}

```js
{
  publicCode,
  userId,
  type: 'course' | 'exam',
  sourceId,
  resultSnapshot,
  status: 'issued' | 'revoked' | 'replaced',
  issuedAt,
  revokedAt,
  replacedBy
}
```

---

## 11. financial_rules/{ruleId}

```js
{
  name,
  appliesTo: 'course' | 'exam' | 'global',
  platformFeeBps: 1000,
  remainderAllocations: [
    { recipientType: 'user' | 'organization', recipientId, weightBps }
  ],
  version,
  status: 'active' | 'inactive',
  effectiveFrom,
  createdBy,
  createdAt
}
```

`weightBps` distribui o valor remanescente após a taxa da plataforma.

---

## 12. system_config/finance

```js
{
  defaultCoursePlatformFeeBps: 1000,
  defaultExamPlatformFeeBps: 1000,
  updatedBy,
  updatedAt,
  version
}
```

Somente papéis financeiros privilegiados podem alterar.

---

## 13. orders/{orderId}

```js
{
  buyerId,
  itemType: 'course' | 'exam',
  itemId,
  status: 'created' | 'pending_payment' | 'confirmed' | 'received' | 'refunded' | 'chargeback' | 'cancelled',
  grossAmountCents,
  currency: 'BRL',
  gateway: 'asaas',
  environment: 'sandbox' | 'production',
  paymentId,
  financialSnapshot: {
    ruleId,
    ruleVersion,
    platformFeeBps,
    recipientAllocations: [],
    walletIds: []
  },
  createdAt,
  updatedAt
}
```

---

## 14. financial_transactions/{transactionId}

Ledger append-only.

```js
{
  orderId,
  type: 'charge' | 'platform_fee' | 'split' | 'gateway_fee' | 'refund' | 'chargeback' | 'adjustment',
  amountCents,
  recipientId,
  externalId,
  status,
  occurredAt,
  createdAt
}
```

Registros não devem ser editados; ajustes geram novos lançamentos.

---

## 15. webhook_events/{eventId}

```js
{
  provider: 'asaas',
  providerEventId,
  eventType,
  payloadHash,
  status: 'received' | 'processed' | 'ignored' | 'failed',
  attempts,
  firstReceivedAt,
  processedAt,
  lastError
}
```

Invariante: `provider + providerEventId` único quando disponível; caso contrário usar hash determinístico.

---

## 16. audit_logs/{logId}

```js
{
  actorId,
  actorRole,
  action,
  entityType,
  entityId,
  before,
  after,
  source: 'web' | 'function' | 'migration',
  requestId,
  createdAt
}
```

Nunca registrar secrets.

---

## 17. system_alerts/{alertId}

```js
{
  type,
  severity: 'info' | 'warning' | 'critical',
  title,
  details,
  entityRefs: [],
  status: 'open' | 'acknowledged' | 'resolved',
  createdAt,
  resolvedAt
}
```
