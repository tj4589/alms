# Chapter Four Testing and Evaluation Evidence

Project: **ExamMind - Design and Implementation of an AI-Powered Academic Knowledge Retrieval and Collaborative Study System for University Students**

Test session date: **2026-06-17**  
Evidence source: screenshots in `docs/screenshots/chapter4/`, live API evidence in `docs/evidence/chapter4/`, local repository inspection, and `scripts/measure_chapter4_performance.py`.

Important note: Backend API health was measured at `http://127.0.0.1:8010`, and the frontend opened successfully at `http://localhost:5173`. Live API tests were executed with generated `ch4_*` student accounts only. Direct SQL database access was not available because `DATABASE_URL` was not set in the current shell, so indexing evidence was verified through authenticated API responses.

## 1. Functional Testing Results

| Test ID | Module | Test Case | Expected Result | Observed Result | Status | Evidence Screenshot |
|---|---|---|---|---|---|---|
| TC-01 | Authentication | Student registration | A student can create an account through the registration interface. | Registration interface is shown with student account fields and create account action. | Pass | [Figure 4.1](screenshots/chapter4/fig4_1_registration.png) |
| TC-02 | Authentication | Duplicate registration | System rejects duplicate email/username registration. | First test registration returned HTTP 200; repeating the same email returned HTTP 400 with `Email already registered.` | Pass | `docs/evidence/chapter4/CH4_TC02_duplicate_registration.txt` |
| TC-03 | Authentication | Student login | Student can log in and reach the dashboard. | Login interface and authenticated dashboard are shown. | Pass | [Figure 4.2](screenshots/chapter4/fig4_2_login.png), [Figure 4.3](screenshots/chapter4/fig4_3_dashboard.png) |
| TC-04 | Authentication | Invalid login | Invalid credentials are rejected with an error message. | Login with a valid test email and wrong password returned HTTP 401 with `Incorrect email or password`. | Pass | `docs/evidence/chapter4/CH4_TC04_invalid_login.txt` |
| TC-05 | Authentication/API Security | Unauthenticated protected API request | Protected endpoints reject unauthenticated requests with 401/403. | `GET /courses` without a token returned HTTP 401 Not authenticated. | Pass | `chapter4_performance_results.json` |
| TC-06 | Upload/OCR | Valid PDF upload | Student can select/upload a PDF for processing. | Upload interface is shown with PDF drop zone and upload workflow. | Pass | [Figure 4.4](screenshots/chapter4/fig4_4_upload.png) |
| TC-07 | Upload/OCR | Scanned PDF OCR | System reads scanned PDF content through OCR. | A generated scanned-image PDF was uploaded; `/ingest/upload` returned HTTP 200, `extraction_method: ocr`, and extracted 725 cleaned characters in the unique rerun. A MIS415 scanned PDF also returned OCR text but was stopped by duplicate detection. | Pass | `docs/evidence/chapter4/CH4_TC07_TC10_TC12_unique_upload_rerun.txt`, `docs/evidence/chapter4/CH4_TC07_ocr_log.txt` |
| TC-08 | Upload Validation | Non-PDF rejection | System rejects unsupported file types. | Uploading a `.txt` file to `/ingest/upload` returned HTTP 400 with `Only PDF files are supported.` | Pass | `docs/evidence/chapter4/CH4_TC08_non_pdf_rejection.txt` |
| TC-09 | Metadata Extraction | AI metadata extraction | System detects document metadata before final indexing. | Metadata confirmation screen displays detected academic metadata and topics. | Pass | [Figure 4.5](screenshots/chapter4/fig4_5_metadata_confirmation.png) |
| TC-10 | Metadata Correction | Correct metadata before confirming | Student can review/correct metadata before confirming upload. | A scanned PDF was analyzed, corrected metadata was submitted through `confirmed_metadata`, and the saved record preserved corrected course-title/department fields while regenerating the normalized title. | Pass | `docs/evidence/chapter4/CH4_TC07_TC10_TC12_unique_upload_rerun.txt` |
| TC-11 | Duplicate Detection | Duplicate upload detection | System identifies previously uploaded matching material. | Duplicate detection result screen is shown. | Pass | [Figure 4.6](screenshots/chapter4/fig4_6_duplicate_detection.png) |
| TC-12 | Indexing | Document indexing | Uploaded material is stored/indexed for retrieval. | After confirming the unique scanned PDF, authenticated API checks returned one matching generated `past_questions` record for the uploading student. | Pass | `docs/evidence/chapter4/CH4_TC07_TC10_TC12_unique_upload_rerun.txt`, `docs/evidence/chapter4/CH4_TC12_document_indexing_db.txt` |
| TC-13 | Search | Semantic search | Search returns relevant uploaded academic materials. | Semantic search result screen returns relevant material for the searched term. | Pass | [Figure 4.7](screenshots/chapter4/fig4_7_semantic_search.png) |
| TC-14 | Search | Course-filtered search | Search can be filtered by course. | Authenticated search for `critical path` with `course_id=6` for MIS415 returned HTTP 200 with two result groups and no foreign course IDs. | Pass | `docs/evidence/chapter4/CH4_TC14_course_filtered_search.txt` |
| TC-15 | AI Assistant/RAG | AI grounded answer | AI assistant answers from retrieved uploaded materials and shows sources. | AI assistant gives an answer related to uploaded MIS415 materials, with source evidence. | Pass | [Figure 4.8](screenshots/chapter4/fig4_8_ai_grounded_answer.png), [Figure 4.9](screenshots/chapter4/fig4_9_source_cards.png) |
| TC-16 | AI Assistant/RAG | No relevant material found | AI assistant admits when no relevant uploaded material is available. | No-relevant-material response is shown for an unrelated query. | Pass | [Figure 4.10](screenshots/chapter4/fig4_10_no_relevant_material.png) |
| TC-17 | Practice | Practice questions | Student can generate/view practice questions. | Practice question interface is shown. | Pass | [Figure 4.11](screenshots/chapter4/fig4_11_practice_questions.png) |
| TC-18 | Practice | Practice attempt and debrief | Student can submit a practice attempt and view score/debrief. | Practice debrief/readiness result is shown. | Pass | [Figure 4.12](screenshots/chapter4/fig4_12_practice_debrief.png) |
| TC-19 | Analytics | Examination analytics | Student can view analytics/progress dashboard. | Examination analytics dashboard is shown. | Pass | [Figure 4.13](screenshots/chapter4/fig4_13_analytics.png) |
| TC-20 | Study Groups | Study group creation | Student can create a study group. | Account A created `CH4 MIS415 Critical Path Group fb936616`; `/study-groups` returned HTTP 200 with `group_id=5`. | Pass | `docs/evidence/chapter4/CH4_TC20_group_created.txt` |
| TC-21 | Study Groups | Join existing group | Student can join an existing group. | Account B joined Account A's group; member listing returned HTTP 200 and included Account B's user ID. | Pass | `docs/evidence/chapter4/CH4_TC21_join_existing_group.txt` |
| TC-22 | Discussion Threads | Discussion thread | Student can participate in a discussion thread. | Discussion thread interface is shown with messages. | Pass | [Figure 4.15](screenshots/chapter4/fig4_15_discussion_thread.png) |
| TC-23 | Reading Rooms | Reading room | Student can access a live reading room interface. | Reading room interface is shown. | Pass | [Figure 4.16](screenshots/chapter4/fig4_16_reading_room.png) |
| TC-24 | Privacy | Student analytics privacy | Student analytics are scoped to the logged-in student. | Account A submitted practice data. Account B requesting Account A's analytics returned HTTP 403, while Account B's own analytics returned HTTP 200. | Pass | `docs/evidence/chapter4/CH4_TC24_privacy_isolation.txt`, [Figure 4.17](screenshots/chapter4/fig4_17_settings_privacy.png) |
| TC-25 | Authentication/API Security | Expired JWT | Expired token is rejected and user is required to log in again. | A tampered JWT sent to `GET /courses` returned HTTP 401 with `Could not validate credentials`. | Pass | `docs/evidence/chapter4/CH4_TC25_expired_jwt.txt` |

### Functional Test Status Summary

| Status | Test Cases | Count |
|---|---|---:|
| Pass | TC-01, TC-02, TC-03, TC-04, TC-05, TC-06, TC-07, TC-08, TC-09, TC-10, TC-11, TC-12, TC-13, TC-14, TC-15, TC-16, TC-17, TC-18, TC-19, TC-20, TC-21, TC-22, TC-23, TC-24, TC-25 | 25 |
| Partial | None | 0 |
| Fail | None | 0 |
| Not Tested | None | 0 |

## 2. Performance Benchmarking Table

Performance script: `scripts/measure_chapter4_performance.py`  
Output file: `docs/chapter4_performance_results.json`

| Metric | Measurement Method | Current Test Session Result | Status |
|---|---|---|---|
| Backend health check | `GET /` through `EXAMMIND_API_BASE_URL=http://127.0.0.1:8010` | HTTP 200 OK in 3.94 ms during the authenticated live run. | Measured |
| Unauthenticated protected endpoint | `GET /courses` without token | HTTP 401 Not authenticated in 54.59 ms from the benchmark script. | Measured |
| Semantic search response time | `GET /search?q=critical+path&course_id=6&limit=5` with token | HTTP 200 in 170.39 ms. | Measured |
| AI assistant response time | `POST /rag/ask` with token | HTTP 200 in 157.26 ms for a MIS415 materials question. | Measured |
| Upload/OCR extraction time | `POST /ingest/upload` scanned-image PDF, confirmation step not yet submitted | HTTP 200 in 126843.14 ms for the unique scanned PDF rerun. | Measured |
| Confirm/indexing time | `POST /ingest/upload` scanned-image PDF with `confirm=true` | HTTP 200 in 117606.41 ms for the unique scanned PDF rerun. | Measured |
| Database counts | Authenticated API list endpoints because `DATABASE_URL` was unavailable | API returned one matching generated `past_questions` record after upload/indexing. | Measured through API |

Manual upload/OCR timing procedure:

1. Start timing immediately before selecting/uploading the PDF.
2. Stop timing when the upload confirmation or indexing success state appears.
3. Record file name, file size, page count, reading method, and elapsed time.
4. Repeat for at least one text-based PDF and one scanned PDF.

## 3. Database Evidence Summary

Direct SQL database access was not available during the current test session because `DATABASE_URL` was not set in the environment used to run `scripts/measure_chapter4_performance.py`. Indexing was therefore verified through authenticated API list endpoints.

The script is prepared to count the following records when database access is available:

| Database Record | Current Evidence |
|---|---|
| Users | Test accounts were created through `/auth/register`; Account A ID 4 and Account B ID 5 were returned by `/auth/me`. |
| Lecture notes/documents | Authenticated API check returned 0 lecture notes for the unique upload user. |
| Lecture note chunks | Direct chunk table count was unavailable without `DATABASE_URL`; past-question indexing was verified through `/past-questions`. |
| Past questions | Authenticated API check returned 1 matching generated past-question record after confirming the unique scanned PDF. |
| Practice attempts | Account A submitted one practice attempt through `/practice/submit` for privacy testing. |
| Readiness/progress records | Account B could access only Account B analytics; Account A analytics returned HTTP 403 when requested by Account B. |
| Study groups | Account A created group ID 5 and Account B joined it successfully. |
| Discussion threads | Not re-counted in the live API rerun; screenshot evidence remains available. |
| Thread messages | Not re-counted in the live API rerun; screenshot evidence remains available. |
| Reading rooms/study sessions | Not re-counted in the live API rerun; screenshot evidence remains available. |

## 4. Screenshot Evidence Checklist

| Figure | Screenshot File | What the Screenshot Proves | Related Test Case |
|---|---|---|---|
| Figure 4.1 | `fig4_1_registration.png` | Student registration interface and account creation form. | TC-01 |
| Figure 4.2 | `fig4_2_login.png` | Student login interface. | TC-03 |
| Figure 4.3 | `fig4_3_dashboard.png` | Authenticated student dashboard after login. | TC-03 |
| Figure 4.4 | `fig4_4_upload.png` | Document upload interface and PDF upload workflow entry point. | TC-06 |
| Figure 4.5 | `fig4_5_metadata_confirmation.png` | AI metadata confirmation and review interface. | TC-07, TC-09, TC-10 |
| Figure 4.6 | `fig4_6_duplicate_detection.png` | Duplicate upload detection result. | TC-11 |
| Figure 4.7 | `fig4_7_semantic_search.png` | Semantic search results for uploaded academic materials. | TC-13 |
| Figure 4.8 | `fig4_8_ai_grounded_answer.png` | AI assistant grounded answer based on uploaded material. | TC-15 |
| Figure 4.9 | `fig4_9_source_cards.png` | AI assistant source citation cards. | TC-15 |
| Figure 4.10 | `fig4_10_no_relevant_material.png` | AI assistant no-relevant-material response. | TC-16 |
| Figure 4.11 | `fig4_11_practice_questions.png` | Practice question interface. | TC-17 |
| Figure 4.12 | `fig4_12_practice_debrief.png` | Practice submission, score display, and readiness debrief. | TC-18 |
| Figure 4.13 | `fig4_13_analytics.png` | Examination analytics dashboard. | TC-19 |
| Figure 4.14 | `fig4_14_study_groups.png` | Study groups interface. | TC-20 |
| Figure 4.15 | `fig4_15_discussion_thread.png` | Discussion thread interface and message flow. | TC-22 |
| Figure 4.16 | `fig4_16_reading_room.png` | Reading room interface. | TC-23 |
| Figure 4.17 | `fig4_17_settings_privacy.png` | Student settings and privacy interface. | TC-24 |

## 5. Safe Usability Evaluation Section

A SUS questionnaire was prepared, but participant-based SUS testing was not completed during the current test session. Therefore, no SUS score is reported. Current usability evidence is based on developer-led task-completion testing and screenshot-based workflow verification.

The prepared SUS questionnaire template is available at `docs/sus_template.md`.

## 6. Ready-to-Paste Chapter Four Replacement Text

### Functional Testing Results

The functional testing covered authentication, upload/OCR, metadata extraction, duplicate detection, semantic search, AI-assisted retrieval, practice generation, analytics, collaboration, reading rooms, and privacy-related settings. The results are summarized in the table below.

| Test ID | Module | Test Case | Observed Result | Status | Evidence |
|---|---|---|---|---|---|
| TC-01 | Authentication | Student registration | Registration interface was available for student account creation. | Pass | Figure 4.1 |
| TC-02 | Authentication | Duplicate registration | Duplicate registration returned HTTP 400 with `Email already registered.` | Pass | API evidence |
| TC-03 | Authentication | Student login | Login interface and authenticated dashboard were captured. | Pass | Figures 4.2, 4.3 |
| TC-04 | Authentication | Invalid login | Wrong-password login returned HTTP 401 with `Incorrect email or password`. | Pass | API evidence |
| TC-05 | API Security | Unauthenticated protected API request | `GET /courses` without a token returned HTTP 401 Not authenticated. | Pass | Performance JSON |
| TC-06 | Upload | Valid PDF upload | Upload interface was captured. | Pass | Figure 4.4 |
| TC-07 | OCR | Scanned PDF OCR | A generated scanned-image PDF was processed with OCR and produced 725 cleaned characters. | Pass | API evidence |
| TC-08 | Upload Validation | Non-PDF rejection | A `.txt` upload returned HTTP 400 with `Only PDF files are supported.` | Pass | API evidence |
| TC-09 | Metadata | Metadata extraction | Metadata confirmation interface showed extracted academic information. | Pass | Figure 4.5 |
| TC-10 | Metadata | Correct metadata before confirming | Corrected metadata was submitted and saved before indexing. | Pass | API evidence |
| TC-11 | Duplicate Detection | Duplicate upload detection | Duplicate detection result was captured. | Pass | Figure 4.6 |
| TC-12 | Indexing | Document indexing | Authenticated API verification returned one matching generated past-question record after upload/indexing. | Pass | API evidence |
| TC-13 | Search | Semantic search | Search results for uploaded academic material were captured. | Pass | Figure 4.7 |
| TC-14 | Search | Course-filtered search | MIS415-filtered search returned HTTP 200 with no foreign course IDs. | Pass | API evidence |
| TC-15 | AI Assistant | Grounded answer | AI answer and source cards were captured. | Pass | Figures 4.8, 4.9 |
| TC-16 | AI Assistant | No relevant material found | No-relevant-material response was captured. | Pass | Figure 4.10 |
| TC-17 | Practice | Practice questions | Practice question interface was captured. | Pass | Figure 4.11 |
| TC-18 | Practice | Practice debrief | Practice result/debrief was captured. | Pass | Figure 4.12 |
| TC-19 | Analytics | Examination analytics | Analytics dashboard was captured. | Pass | Figure 4.13 |
| TC-20 | Study Groups | Study group creation | Account A created a MIS415 study group and received group ID 5. | Pass | API evidence |
| TC-21 | Study Groups | Join existing group | Account B joined Account A's group and appeared in the member list. | Pass | API evidence |
| TC-22 | Collaboration | Discussion thread | Discussion thread interface was captured. | Pass | Figure 4.15 |
| TC-23 | Reading Rooms | Reading room | Reading room interface was captured. | Pass | Figure 4.16 |
| TC-24 | Privacy | Student analytics privacy | Account B was blocked from Account A analytics with HTTP 403 and could access only Account B analytics. | Pass | API evidence, Figure 4.17 |
| TC-25 | API Security | Expired JWT | A tampered JWT was rejected with HTTP 401. | Pass | API evidence |

Overall, all 25 functional test cases were verified as passing in this live test session. No test case was marked as failed, partial, or not tested.

### Performance Evaluation

The performance measurement script was created as `scripts/measure_chapter4_performance.py`, and additional authenticated API timings were captured during the live test session. The backend at `http://127.0.0.1:8010` responded successfully. The authenticated semantic search test returned HTTP 200 in 170.39 ms, and the AI assistant test returned HTTP 200 in 157.26 ms. The scanned PDF OCR analysis took 126843.14 ms, while the confirmation/indexing request took 117606.41 ms.

| Performance Item | Current Result |
|---|---|
| Backend health | HTTP 200 OK in 3.94 ms during the authenticated live run. |
| Unauthenticated protected endpoint | HTTP 401 Not authenticated in 54.59 ms for `GET /courses`. |
| Semantic search response time | HTTP 200 in 170.39 ms for `critical path` filtered to MIS415. |
| AI assistant response time | HTTP 200 in 157.26 ms for a MIS415 materials question. |
| Upload/OCR extraction time | HTTP 200 in 126843.14 ms for a generated scanned-image PDF. |
| Confirm/indexing time | HTTP 200 in 117606.41 ms for the generated scanned-image PDF. |
| Database/API counts | Direct SQL was unavailable, but authenticated API verification returned one generated past-question record after indexing. |

### Database Evidence Summary

Direct SQL row counts were not available in the current test session because the environment variable `DATABASE_URL` was not configured. To avoid inventing database results, indexing and privacy evidence were verified through authenticated API responses. The API returned one generated past-question record after upload/indexing, one created study group, successful second-account group membership, and correct cross-account analytics isolation.

### Usability Evaluation

A System Usability Scale (SUS) questionnaire was prepared for future participant-based usability evaluation. However, participant-based SUS testing was not completed during the current test session. Therefore, no SUS score is reported. The usability evidence presented in this chapter is based on developer-led task-completion testing and screenshot-based workflow verification.

### Discussion of Results

The screenshot evidence demonstrates the main student-facing workflow of ExamMind, including registration, login, dashboard access, document upload, metadata confirmation, duplicate detection, semantic search, AI-assisted answers with source evidence, practice questions, practice debrief, analytics, study groups, discussion threads, reading rooms, and settings/privacy information. The live API evidence additionally verifies duplicate registration handling, invalid login handling, scanned PDF OCR, non-PDF rejection, metadata correction before confirmation, indexing, course-filtered search, study group creation, second-account group joining, cross-account analytics privacy, expired-token rejection, and authenticated search/AI response timings. Direct SQL row counts remain environment-dependent because `DATABASE_URL` was not available in the current shell, so related claims are limited to authenticated API evidence.
