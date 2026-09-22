"use strict";

const assert =
  require("node:assert/strict");

const fs =
  require("node:fs");

const path =
  require("node:path");

const api =
  require(
    "../js/belt-exam-api-v1_2.js"
  );

const execution =
  require(
    "../js/belt-exam-execution-ui-v1_2.js"
  );

const runtime =
  require(
    "../js/firebase-runtime-v1_2.js"
  );

let passed = 0;

async function test(
  name,
  fn
) {
  await fn();

  passed += 1;

  console.log(
    `PASS | ${name}`
  );
}

function read(relativePath) {
  return fs.readFileSync(
    path.join(
      __dirname,
      "..",
      relativePath
    ),
    "utf8"
  );
}

async function main() {
  await test(
    "API autoriza somente callables canonicas de execucao",
    () => {
      assert.equal(
        api.ALLOWED_FUNCTIONS.has(
          "iniciarExameOficialV12"
        ),
        true
      );

      assert.equal(
        api.ALLOWED_FUNCTIONS.has(
          "obterTentativaExameOficialV12"
        ),
        true
      );

      assert.equal(
        api.ALLOWED_FUNCTIONS.has(
          "finalizarExameOficialV12"
        ),
        true
      );

      assert.equal(
        api.ALLOWED_FUNCTIONS.has(
          "iniciarExameSeguro"
        ),
        false
      );
    }
  );

  await test(
    "start resume e finalize enviam payload minimo",
    async () => {
      const requests = [];

      const options = {
        explicitEnvironment:
          "staging",
        idToken:
          "token-gate-5a1",
        fetchImpl:
          async (
            url,
            fetchOptions
          ) => {
            requests.push({
              url,
              body:
                JSON.parse(
                  fetchOptions.body
                )
            });

            return {
              ok: true,
              status: 200,
              headers: {
                get: () =>
                  "application/json"
              },
              text:
                async () =>
                  JSON.stringify({
                    result: {
                      ok: true
                    }
                  })
            };
          }
      };

      await api.startOfficialExam(
        "registration_1",
        options
      );

      await api.resumeOfficialExam(
        "registration_1",
        options
      );

      await api.finalizeOfficialExam(
        "attempt_1",
        {
          question_1:
            " a ",
          question_blank:
            ""
        },
        options
      );

      assert.deepEqual(
        requests[0].body.data,
        {
          registrationId:
            "registration_1"
        }
      );

      assert.deepEqual(
        requests[1].body.data,
        {
          registrationId:
            "registration_1"
        }
      );

      assert.deepEqual(
        requests[2].body.data,
        {
          attemptId:
            "attempt_1",
          answers: {
            question_1:
              "A"
          }
        }
      );
    }
  );

  await test(
    "execution parser aceita apenas registrationId valido",
    () => {
      assert.equal(
        execution.parseRegistrationId(
          "?registrationId=registration_1"
        ),
        "registration_1"
      );

      assert.throws(
        () =>
          execution.parseRegistrationId(
            "?registrationId=a/b"
          ),
        /inválido/
      );
    }
  );

  await test(
    "timestamp publico suporta Date ISO e Timestamp serializado",
    () => {
      const expected =
        Date.parse(
          "2026-09-22T20:00:00.000Z"
        );

      assert.equal(
        execution.timestampToMillis(
          new Date(expected)
        ),
        expected
      );

      assert.equal(
        execution.timestampToMillis(
          "2026-09-22T20:00:00.000Z"
        ),
        expected
      );

      assert.equal(
        execution.timestampToMillis({
          _seconds:
            expected / 1000,
          _nanoseconds:
            0
        }),
        expected
      );
    }
  );

  await test(
    "payload de respostas aceita somente questoes da tentativa",
    () => {
      const questions = [
        {
          id:
            "q1",
          prompt:
            "Questão 1",
          alternatives: {
            A:
              "A",
            B:
              "B"
          },
          media: {}
        },
        {
          id:
            "q2",
          prompt:
            "Questão 2",
          alternatives: {
            A:
              "A",
            B:
              "B"
          },
          media: {}
        }
      ];

      assert.deepEqual(
        execution.buildAnswerPayload(
          questions,
          {
            q1:
              "a",
            q2:
              null
          }
        ),
        {
          q1:
            "A"
        }
      );

      assert.throws(
        () =>
          execution.buildAnswerPayload(
            questions,
            {
              q3:
                "B"
            }
          ),
        /fora da tentativa/
      );
    }
  );

  await test(
    "runtime carrega execucao somente na pagina exame",
    () => {
      assert.deepEqual(
        runtime.BELT_EXAM_PAGE_MODULES[
          "exame.html"
        ],
        [
          "js/belt-exam-api-v1_2.js",
          "js/belt-exam-execution-ui-v1_2.js"
        ]
      );

      assert.equal(
        runtime.inferEnvironment({
          hostname:
            "bjj-exams.web.app"
        }),
        "production"
      );
    }
  );

  await test(
    "pagina oficial nao usa Firestore nem fluxo legado",
    () => {
      const html =
        read("exame.html");

      assert.match(
        html,
        /firebase-runtime-v1_2\.js/
      );

      assert.match(
        html,
        /loadConfig/
      );

      for (
        const forbidden of [
          "firebase-firestore",
          "getFirestore(",
          "config_exames",
          "tentativas_exame",
          "creditos_professor",
          "resposta_correta",
          "addDoc(",
          "setDoc(",
          "updateDoc("
        ]
      ) {
        assert.equal(
          html.includes(
            forbidden
          ),
          false,
          forbidden
        );
      }
    }
  );

  await test(
    "modulo de execucao nao le colecoes nem calcula gabarito",
    () => {
      const source =
        read(
          "js/belt-exam-execution-ui-v1_2.js"
        );

      for (
        const forbidden of [
          "getFirestore(",
          "collection(",
          "getDoc(",
          "getDocs(",
          "setDoc(",
          "updateDoc(",
          "addDoc(",
          "config_exames",
          "questoes\"",
          "tentativas_exame",
          "resultados\"",
          "certificados\"",
          "creditos_professor",
          "resposta_correta",
          "correctAnswer"
        ]
      ) {
        assert.equal(
          source.includes(
            forbidden
          ),
          false,
          forbidden
        );
      }

      assert.match(
        source,
        /finalizeOfficialExam/
      );

      assert.match(
        source,
        /resultPercentage/
      );
    }
  );

  console.log(
    `BELT_EXAM_EXECUTION_FRONTEND_V1_2=${passed}/8`
  );

  if (passed !== 8) {
    process.exitCode = 1;
  }
}

main().catch(
  error => {
    console.error(error);
    process.exitCode = 1;
  }
);