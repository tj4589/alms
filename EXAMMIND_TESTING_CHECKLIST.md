# ExamMind Testing Checklist and Evidence Plan

## Chapter Four Testing Overview

This document presents the functional testing checklist and evidence collection plan for ExamMind. The purpose of the tests is to verify that the implemented system satisfies the project requirements, handles user workflows correctly, and provides reliable academic support through uploaded materials, OCR, search, RAG-based AI assistance, practice generation, collaboration, and progress tracking.

Test status values:

- Pending: Test has not been executed.
- Passed: Actual result matches the expected result.
- Failed: Actual result does not match the expected result.
- Partial: Feature works but requires improvement or has minor limitations.

Evidence format:

- Screenshot placeholders should be replaced with screenshots captured during testing.
- Actual result should be completed after each test execution.
- Screenshots should be named consistently, for example `CH4_AUTH_001_LOGIN_SUCCESS.png`.

## Functional Testing Table

| Test ID | Module | Test Scenario | Input | Expected Result | Actual Result | Status | Screenshot Placeholder |
|---|---|---|---|---|---|---|---|
| AUTH-001 | Authentication | Student registers successfully | Valid name, email, username, password | Account is created and user is redirected or logged in | To be recorded | Pending | `[Screenshot: AUTH-001 registration success]` |
| AUTH-002 | Authentication | User logs in successfully | Registered email/username and password | Dashboard opens with authenticated session | To be recorded | Pending | `[Screenshot: AUTH-002 login success]` |
| AUTH-003 | Authentication | Invalid login is rejected | Wrong password | System shows friendly error and does not log user in | To be recorded | Pending | `[Screenshot: AUTH-003 invalid login]` |
| AUTH-004 | Authentication | Protected routes require login | Open dashboard without token | User is redirected to login screen | To be recorded | Pending | `[Screenshot: AUTH-004 protected route]` |
| FUNC-001 | Dashboard | Dashboard loads after login | Authenticated student | Dashboard cards and navigation are visible | To be recorded | Pending | `[Screenshot: FUNC-001 dashboard]` |
| FUNC-002 | Navigation | User switches between modules | Sidebar/module links | Correct screen opens without page crash | To be recorded | Pending | `[Screenshot: FUNC-002 navigation]` |
| FUNC-003 | Course Resource Linking | Uploaded course appears globally | Upload MIS415 document | MIS415 appears in courses, practice, groups, and rooms | To be recorded | Pending | `[Screenshot: FUNC-003 course linking]` |

## Upload and OCR Testing Table

| Test ID | Module | Test Scenario | Input | Expected Result | Actual Result | Status | Screenshot Placeholder |
|---|---|---|---|---|---|---|---|
| UPLOAD-001 | Upload and OCR | Upload a readable PDF past question | `mis415 22-23.pdf` | File uploads and analysis begins | To be recorded | Pending | `[Screenshot: UPLOAD-001 upload start]` |
| UPLOAD-002 | Upload and OCR | OCR extracts text from scanned PDF | Scanned MIS415 PDF | Extracted text count is meaningful and document is searchable | To be recorded | Pending | `[Screenshot: UPLOAD-002 OCR success]` |
| UPLOAD-003 | Upload Preview | Clean structured confirmation preview appears | MIS415 PDF | Preview shows instruction, scenario, detected questions, topics, confidence badge | To be recorded | Pending | `[Screenshot: UPLOAD-003 structured preview]` |
| UPLOAD-004 | Upload Preview | Raw OCR hidden by default | MIS415 PDF confirmation screen | Raw OCR text is not visible unless user clicks `View raw OCR text` | To be recorded | Pending | `[Screenshot: UPLOAD-004 raw OCR hidden]` |
| UPLOAD-005 | Upload Preview | Raw OCR debug view opens manually | Click `View raw OCR text` | Full OCR text appears in collapsible/debug view | To be recorded | Pending | `[Screenshot: UPLOAD-005 raw OCR view]` |
| UPLOAD-006 | Upload and OCR | OCR noise is removed from main preview | PDF with noisy OCR fragments | Main preview does not show broken symbols, stamps, or garbage fragments | To be recorded | Pending | `[Screenshot: UPLOAD-006 clean preview]` |
| UPLOAD-007 | Upload Error Handling | Unsupported file upload is rejected | Non-PDF file | System shows friendly unsupported-file message | To be recorded | Pending | `[Screenshot: UPLOAD-007 unsupported file]` |
| UPLOAD-008 | Upload Error Handling | Blurry/unreadable scan is handled | Poor quality scanned PDF | System shows review/manual metadata message instead of crashing | To be recorded | Pending | `[Screenshot: UPLOAD-008 low confidence]` |

## Metadata Extraction Testing Table

| Test ID | Module | Test Scenario | Input | Expected Result | Actual Result | Status | Screenshot Placeholder |
|---|---|---|---|---|---|---|---|
| META-001 | Metadata Extraction | Course code is detected | MIS415 past question | `MIS415` is detected as course code | To be recorded | Pending | `[Screenshot: META-001 course code]` |
| META-002 | Metadata Extraction | Course title is normalized | `COURSE TITLE: PROJECT MANAGEMENT TIME: 2 HOURS` | Title becomes `Project Management` | To be recorded | Pending | `[Screenshot: META-002 course title]` |
| META-003 | Metadata Extraction | Academic session is formatted correctly | `2022/2023` document | Session displays as `2022/2023`, not `20222023` | To be recorded | Pending | `[Screenshot: META-003 session]` |
| META-004 | Metadata Extraction | Document title is clean | MIS415 PDF | Title becomes `MIS415 Project Management Past Question 2022/2023` | To be recorded | Pending | `[Screenshot: META-004 title]` |
| META-005 | Metadata Extraction | Semester is detected | Alpha semester document | Semester displays as `Alpha` | To be recorded | Pending | `[Screenshot: META-005 semester]` |
| META-006 | Topic Extraction | Relevant topics are detected | MIS415 OCR text | Topics include critical path, risk management, cost management, stakeholder management | To be recorded | Pending | `[Screenshot: META-006 topics]` |
| META-007 | Course Linking | Course record is created | Confirm MIS415 upload | `GET /courses` includes `MIS415 - Project Management` | To be recorded | Pending | `[Screenshot: META-007 courses API]` |

## Duplicate Detection Testing Table

| Test ID | Module | Test Scenario | Input | Expected Result | Actual Result | Status | Screenshot Placeholder |
|---|---|---|---|---|---|---|---|
| DUP-001 | Duplicate Detection | Upload same document twice | Upload `mis415 22-23.pdf` after first confirmation | System detects duplicate and prevents duplicate indexing | To be recorded | Pending | `[Screenshot: DUP-001 duplicate]` |
| DUP-002 | Duplicate Detection | Duplicate message is user friendly | Same MIS415 upload | Existing document information is shown clearly | To be recorded | Pending | `[Screenshot: DUP-002 duplicate message]` |
| DUP-003 | Duplicate Detection | Similar but different document is allowed | Different course/year PDF | System does not falsely block upload | To be recorded | Pending | `[Screenshot: DUP-003 non-duplicate]` |

## Search Testing Table

| Test ID | Module | Test Scenario | Input | Expected Result | Actual Result | Status | Screenshot Placeholder |
|---|---|---|---|---|---|---|---|
| SEARCH-001 | Search | Search by course code | `MIS415` | One clean MIS415 document card appears | To be recorded | Pending | `[Screenshot: SEARCH-001 MIS415]` |
| SEARCH-002 | Search | Search by course title | `Project Management` | MIS415 Project Management past question appears | To be recorded | Pending | `[Screenshot: SEARCH-002 project management]` |
| SEARCH-003 | Search | Search by topic | `critical path` | MIS415 document appears with relevant snippet | To be recorded | Pending | `[Screenshot: SEARCH-003 critical path]` |
| SEARCH-004 | Search | Search by calculation term | `cost variance` | MIS415 document appears with cost/EVM snippet | To be recorded | Pending | `[Screenshot: SEARCH-004 cost variance]` |
| SEARCH-005 | Search | Group duplicate chunk matches | `risk management` | Search shows one document card, not repeated chunk cards | To be recorded | Pending | `[Screenshot: SEARCH-005 grouped results]` |
| SEARCH-006 | Search | Clean title display | Search MIS415 | Title is `MIS415 Project Management Past Question 2022/2023` | To be recorded | Pending | `[Screenshot: SEARCH-006 clean title]` |
| SEARCH-007 | Search | Clean snippet display | Search noisy OCR document | Snippets do not show random symbols or OCR garbage | To be recorded | Pending | `[Screenshot: SEARCH-007 clean snippets]` |
| SEARCH-008 | Search Action Routing | Learn more with AI | Click search AI action | AI Assistant opens and auto-submits grounded query | To be recorded | Pending | `[Screenshot: SEARCH-008 AI action]` |
| SEARCH-009 | Search Action Routing | Generate practice | Click practice action from MIS415 result | Practice opens with MIS415/topic preselected | To be recorded | Pending | `[Screenshot: SEARCH-009 practice action]` |
| SEARCH-010 | Search Action Routing | Start discussion | Click discussion action | Collaboration opens with thread form prefilled | To be recorded | Pending | `[Screenshot: SEARCH-010 discussion action]` |
| SEARCH-011 | Search Action Routing | Create study group | Click group action | Study Groups tab opens with form prefilled | To be recorded | Pending | `[Screenshot: SEARCH-011 group action]` |
| SEARCH-012 | Search Action Routing | Start reading room | Click room action | Reading Rooms tab opens with room form prefilled | To be recorded | Pending | `[Screenshot: SEARCH-012 room action]` |

## AI Assistant Testing Table

| Test ID | Module | Test Scenario | Input | Expected Result | Actual Result | Status | Screenshot Placeholder |
|---|---|---|---|---|---|---|---|
| AI-001 | AI Assistant / RAG | Ask about uploaded MIS415 content | `What topics appear in the MIS415 2022/2023 past question?` | AI returns grounded answer from uploaded MIS415 material | To be recorded | Pending | `[Screenshot: AI-001 MIS415 answer]` |
| AI-002 | AI Assistant / RAG | Source citation appears | Same as AI-001 | Sources include MIS415 Project Management Past Question 2022/2023 | To be recorded | Pending | `[Screenshot: AI-002 sources]` |
| AI-003 | AI Assistant / RAG | Topic list is accurate | Same as AI-001 | Answer mentions critical path, risk, communication, procurement, cost, stakeholder topics | To be recorded | Pending | `[Screenshot: AI-003 topic list]` |
| AI-004 | AI Assistant / RAG | Follow-up memory works | After AI-001, ask `okay so what did you find?` | AI continues MIS415 context, not generic/unclear response | To be recorded | Pending | `[Screenshot: AI-004 follow-up]` |
| AI-005 | AI Assistant / RAG | No placeholder final answer | Ask uploaded-material question | Final assistant response is real RAG answer, not only “I will check…” | To be recorded | Pending | `[Screenshot: AI-005 no placeholder]` |
| AI-006 | AI Provider Fallback | DeepSeek succeeds | Valid DeepSeek balance/key | AI answer is generated normally | To be recorded | Pending | `[Screenshot: AI-006 deepseek success]` |
| AI-007 | AI Provider Fallback | DeepSeek insufficient balance falls back | Simulate/observe 402 from DeepSeek with Cohere configured | Cohere returns answer without raw provider error | To be recorded | Pending | `[Screenshot: AI-007 cohere fallback]` |
| AI-008 | AI Provider Fallback | Both providers fail gracefully | Disable/invalid keys | User sees friendly unavailable message | To be recorded | Pending | `[Screenshot: AI-008 provider failure]` |
| AI-009 | AI Assistant / RAG | No source found | Ask about unrelated topic not uploaded | AI says no relevant uploaded source was found | To be recorded | Pending | `[Screenshot: AI-009 no source]` |
| AI-010 | AI Assistant / RAG | OCR uncertainty is handled | Ask about noisy scanned document | AI answers from usable text and notes review may be needed | To be recorded | Pending | `[Screenshot: AI-010 OCR caveat]` |

## Practice Testing Table

| Test ID | Module | Test Scenario | Input | Expected Result | Actual Result | Status | Screenshot Placeholder |
|---|---|---|---|---|---|---|---|
| PRAC-001 | Practice Generation | Real backend courses load | Open Practice page | Course dropdown includes MIS415 - Project Management | To be recorded | Pending | `[Screenshot: PRAC-001 courses]` |
| PRAC-002 | Practice Generation | Search context preselects course | Click Generate practice from MIS415 search | MIS415 and topic are preselected | To be recorded | Pending | `[Screenshot: PRAC-002 preselect]` |
| PRAC-003 | Practice Generation | Generate by course and topic | Course MIS415, topic `critical path` | Questions are generated from uploaded MIS415 past question | To be recorded | Pending | `[Screenshot: PRAC-003 critical path practice]` |
| PRAC-004 | Practice Generation | Flexible topic match works | Course MIS415, topic `cost variance` | Questions are generated if topic appears in content/metadata | To be recorded | Pending | `[Screenshot: PRAC-004 cost variance]` |
| PRAC-005 | Practice Generation | Broad fallback warning | Course MIS415, weak topic match | Practice generated from broader course questions with warning | To be recorded | Pending | `[Screenshot: PRAC-005 broad fallback]` |
| PRAC-006 | Practice Submission | User submits score | Mark questions correct/incorrect | Readiness/progress updates after submission | To be recorded | Pending | `[Screenshot: PRAC-006 submit]` |
| PRAC-007 | Practice Empty State | No matching material | Select course with no past questions | Friendly message explains not enough data exists | To be recorded | Pending | `[Screenshot: PRAC-007 empty state]` |

## Collaboration Testing Table

| Test ID | Module | Test Scenario | Input | Expected Result | Actual Result | Status | Screenshot Placeholder |
|---|---|---|---|---|---|---|---|
| COLLAB-001 | Study Collaboration | Create discussion thread manually | Thread title and optional course | Thread is created and listed | To be recorded | Pending | `[Screenshot: COLLAB-001 create thread]` |
| COLLAB-002 | Study Collaboration | Create discussion from search | Search MIS415, click Start discussion thread | Thread form opens with MIS415/material context | To be recorded | Pending | `[Screenshot: COLLAB-002 search thread]` |
| COLLAB-003 | Study Collaboration | Post message in thread | Text message | Message appears in thread | To be recorded | Pending | `[Screenshot: COLLAB-003 message]` |
| COLLAB-004 | Thread @AI | Ask @AI in thread | `@AI explain critical path` | AI replies using linked uploaded material/context | To be recorded | Pending | `[Screenshot: COLLAB-004 thread AI]` |
| GROUP-001 | Study Groups | Create study group manually | Name, course, topic | Group is created and listed | To be recorded | Pending | `[Screenshot: GROUP-001 create group]` |
| GROUP-002 | Study Groups | Create study group from search | Search MIS415, click Create study group | Group form is prefilled with course/topic | To be recorded | Pending | `[Screenshot: GROUP-002 search group]` |
| GROUP-003 | Study Groups | Join group | Click Join | User becomes group member | To be recorded | Pending | `[Screenshot: GROUP-003 join group]` |
| GROUP-004 | Study Groups | Leave group | Click Leave | User is removed from group members | To be recorded | Pending | `[Screenshot: GROUP-004 leave group]` |

## Reading Room Testing Table

| Test ID | Module | Test Scenario | Input | Expected Result | Actual Result | Status | Screenshot Placeholder |
|---|---|---|---|---|---|---|---|
| ROOM-001 | Reading Rooms | Create room manually | Title, course MIS415, topic critical path | Reading room is created and opened | To be recorded | Pending | `[Screenshot: ROOM-001 create room]` |
| ROOM-002 | Reading Rooms | Create room from search | Search MIS415, click Start reading room | Room form prefilled with MIS415 context | To be recorded | Pending | `[Screenshot: ROOM-002 search room]` |
| ROOM-003 | Reading Rooms | Room displays course/topic | Open MIS415 room | Room header shows course/topic/goal | To be recorded | Pending | `[Screenshot: ROOM-003 room context]` |
| ROOM-004 | Reading Rooms | AI Study Board creates card | Ask `what is critical path about?` | AI answer card appears on shared board | To be recorded | Pending | `[Screenshot: ROOM-004 AI card]` |
| ROOM-005 | Reading Rooms | AI answer is room-grounded | MIS415 room, ask critical path question | Answer relates to MIS415/project network diagram/WAN project context | To be recorded | Pending | `[Screenshot: ROOM-005 room-grounded answer]` |
| ROOM-006 | Reading Rooms | Discussion chat works | Send room chat message | Message appears in Discussion tab | To be recorded | Pending | `[Screenshot: ROOM-006 chat]` |
| ROOM-007 | Reading Rooms | Participants display works | Join room as user | Participant appears in People/In this room panel | To be recorded | Pending | `[Screenshot: ROOM-007 participants]` |
| ROOM-008 | Reading Rooms | Break/back status works | Click break/back to study | Status updates correctly | To be recorded | Pending | `[Screenshot: ROOM-008 status]` |

## Privacy Testing Table

| Test ID | Module | Test Scenario | Input | Expected Result | Actual Result | Status | Screenshot Placeholder |
|---|---|---|---|---|---|---|---|
| PRIV-001 | Privacy Settings | User opens privacy settings | Click Privacy/Settings if available | Privacy options are visible or unavailable message is friendly | To be recorded | Pending | `[Screenshot: PRIV-001 privacy settings]` |
| PRIV-002 | Privacy Settings | User data is protected by login | Access API without token | API rejects request with authentication error | To be recorded | Pending | `[Screenshot: PRIV-002 unauthorized API]` |
| PRIV-003 | Privacy Settings | User cannot access another student's protected data | Student attempts to open another user's private progress endpoint | System rejects unauthorized access | To be recorded | Pending | `[Screenshot: PRIV-003 protected student data]` |
| PRIV-004 | Privacy Settings | Raw OCR is not exposed by default | Upload confirmation screen | Raw OCR hidden behind manual debug button | To be recorded | Pending | `[Screenshot: PRIV-004 raw text privacy]` |
| PRIV-005 | Privacy Settings | User session can be cleared | Logout | Token is removed and login screen appears | To be recorded | Pending | `[Screenshot: PRIV-005 logout]` |

## Analytics and Progress Testing Table

| Test ID | Module | Test Scenario | Input | Expected Result | Actual Result | Status | Screenshot Placeholder |
|---|---|---|---|---|---|---|---|
| AN-001 | Analytics/Progress | Progress page loads | Open Progress | User readiness/progress screen appears | To be recorded | Pending | `[Screenshot: AN-001 progress page]` |
| AN-002 | Analytics/Progress | Practice affects progress | Submit practice attempt | Progress/readiness reflects submitted score | To be recorded | Pending | `[Screenshot: AN-002 practice progress]` |
| AN-003 | Analytics/Progress | Analytics screen loads | Open Analytics | Analytics cards/charts display without crash | To be recorded | Pending | `[Screenshot: AN-003 analytics]` |
| AN-004 | Analytics/Progress | Empty analytics state is handled | No attempts/data | Screen shows clean empty state or default values | To be recorded | Pending | `[Screenshot: AN-004 empty analytics]` |

## Error Handling Testing Table

| Test ID | Module | Test Scenario | Input | Expected Result | Actual Result | Status | Screenshot Placeholder |
|---|---|---|---|---|---|---|---|
| ERR-001 | Error Handling | Backend is offline | Use frontend while backend stopped | Frontend shows connection error, not blank screen | To be recorded | Pending | `[Screenshot: ERR-001 backend offline]` |
| ERR-002 | Error Handling | AI provider balance is low | DeepSeek returns 402 | User sees friendly AI unavailable/balance message | To be recorded | Pending | `[Screenshot: ERR-002 AI balance]` |
| ERR-003 | Error Handling | Fallback provider works | DeepSeek fails, Cohere configured | User receives AI answer without raw error | To be recorded | Pending | `[Screenshot: ERR-003 fallback success]` |
| ERR-004 | Error Handling | Both AI providers fail | Invalid/removed API keys | User sees friendly unavailable message; search/practice remain usable | To be recorded | Pending | `[Screenshot: ERR-004 both providers fail]` |
| ERR-005 | Error Handling | Search with no results | Search unrelated phrase | Clean empty state with upload/action options | To be recorded | Pending | `[Screenshot: ERR-005 no search results]` |
| ERR-006 | Error Handling | Practice without data | Select course with no past questions | Friendly no-data explanation appears | To be recorded | Pending | `[Screenshot: ERR-006 practice no data]` |
| ERR-007 | Error Handling | Duplicate upload error path | Upload existing document | Duplicate detected without crashing | To be recorded | Pending | `[Screenshot: ERR-007 duplicate handling]` |

## Evidence Collection Plan

1. Prepare test data:
   - Student account credentials for testing.
   - MIS415 Project Management Past Question 2022/2023 PDF.
   - One unsupported file type for upload error testing.
   - One unrelated search term for no-result testing.

2. Capture screenshots:
   - Use one screenshot per test where the interface changes.
   - Name files using the Test ID, for example `SEARCH-001-MIS415-result.png`.
   - Store screenshots in a folder such as `chapter-four-evidence/screenshots`.

3. Record actual results:
   - Replace `To be recorded` with the observed behavior.
   - Set status to Passed, Failed, or Partial.
   - For failed tests, add a short note explaining the observed issue.

4. Recommended defense evidence sequence:
   - Login and dashboard.
   - Upload MIS415 document.
   - Show clean metadata and structured preview.
   - Confirm upload and show duplicate detection.
   - Search MIS415 and cost variance.
   - Ask AI Assistant about MIS415 topics.
   - Generate MIS415 practice.
   - Create discussion, study group, and reading room from search.
   - Ask Reading Room AI about critical path.
   - Show progress/analytics after practice submission.

## Chapter Four Summary Template

The functional testing conducted on ExamMind confirmed that the major system modules worked together to support academic material upload, OCR extraction, metadata detection, duplicate prevention, semantic search, AI-assisted explanation, practice generation, and collaborative study. The upload module successfully extracted and structured content from the MIS415 Project Management past question, while search retrieved the uploaded material using both course and topic queries. The AI Assistant and Reading Room AI were evaluated using uploaded material queries to confirm that generated answers were grounded in indexed ExamMind resources. Practice generation was tested to verify that uploaded past questions could be reused for revision. Collaboration, study groups, and reading rooms were tested to demonstrate the social learning features of the system. Error handling tests were also included to ensure that users receive friendly messages when uploads, AI providers, or backend services fail.

Overall testing evidence should be supported with screenshots for each completed test case and summarized in the final Chapter Four results section.
