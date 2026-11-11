***

# Business Requirements Document (BRD): School Admission System

## 1. Executive Summary
The **School Admission System** is a high-concurrency, full-stack web application designed to handle online admissions for a government school. The system operates on a **"First Come, First Served"** basis without a lottery system. It must reliably handle massive concurrent traffic (thousands of guardians applying simultaneously) while strictly preventing overbooking of available seats. 

The system facilitates seat holding, simulated payment/confirmation, and application cancellation, utilizing a containerized architecture for seamless deployment.

---

## 2. Project Scope
### 2.1 In-Scope
*   Backend API development for class management, seat holding, and confirmation.
*   Frontend React application for both School Admins and Guardians/Students.
*   Real-time seat availability tracking without page reloads.
*   Automatic expiration of unconfirmed seat holds.
*   Dockerized deployment for the database, backend, and frontend.
*   Automated testing, including a mandatory concurrency test.

### 2.2 Out-of-Scope
*   Actual payment gateway integration (payment is simulated).
*   Authentication/Login systems (identification is handled via a header).
*   Multi-tenant school management (designed for a single school context).

---

## 3. Stakeholders & User Roles
*   **School Admin:** Responsible for creating new classes/shifts and defining seat capacities.
*   **Guardian/Student:** Responsible for viewing available classes, applying for a seat hold, confirming admission via "payment," and cancelling applications.

---

## 4. Functional Requirements

### 4.1 Frontend (UI) Requirements
*   **No Login System:** The application must identify users via a 17-character Student Registration Number inputted in a field at the top of the page. This value will act as the user's identity.
*   **Admin Dashboard (Class Creation):** Admins must be able to create a new class by providing a Name and Total Seats. *(Note: A specific grade with multiple shifts, e.g., "Class 6 - Morning Shift" and "Class 6 - Day Shift", are treated as separate classes).*
*   **Class Listing:** 
    *   Display all classes with real-time stats: Total Seats, Held Seats, Confirmed Seats, and Available Seats.
    *   Include an "Apply" (আবেদন করুন) button.
*   **Application Management (User Level):**
    *   Show the current status of active applications.
    *   Show a countdown timer for how much time is left before a hold expires.
    *   Provide a "Pay Fee / Confirm" (ভর্তি ফি দিন) button and a "Cancel" (বাতিল) button.
    *   *Payment Simulation:* Clicking "Pay Fee" assumes a successful payment.
*   **My Applications:** A view for the student to see all their past and present applications and their respective statuses.
*   **Real-time Updates:** 
    *   Seat numbers must update automatically without a page reload (e.g., via polling).
    *   If a hold expires, the UI must automatically change the status to `EXPIRED` and disable the "Pay Fee" button without a page reload.
    *   State must persist across page refreshes or browser restarts.

### 4.2 Backend Logic Requirements
*   **Seat Holding:** When a user applies, a seat is placed on `HOLD` for a configurable duration.
*   **Automatic Expiration:** Holds must expire automatically based on an environment variable (`HOLD_DURATION_SECONDS`, default: 600 seconds). Expired holds must return the seat to the available pool without requiring an external API call.
*   **Confirmation:** A user can only confirm their own, unexpired `HELD` application.
*   **Idempotency:** If a single application is confirmed multiple times (e.g., double-click), the `confirmedSeats` count must only increment once.
*   **Single Active Application:** A student cannot have more than one active application (Hold or Confirmed) for the same class at the same time.

---

## 5. Business Rules & Concurrency Constraints (Critical)
*   **No Overbooking:** The sum of `held + confirmed` seats must **never** exceed `totalSeats` for any class, regardless of concurrent requests. (Must be enforced at the database level to handle simultaneous transactions).
*   **Multi-Process Safety (Bonus Requirement):** If two separate backend instances run on different ports pointing to the same database, the no-overbooking rule must still hold true.
*   **Data Persistence:** Application data must not be lost upon restart. The system must survive a `docker compose down` and `docker compose up` cycle.

---

## 6. Technical Architecture & Stack
*   **Backend:** C# (.NET 8 or newer), utilizing an ORM for PostgreSQL. Expose API on `http://localhost:8080`.
*   **Database:** PostgreSQL. Database connection strings must be configurable via environment variables.
*   **Frontend:** React 18+, JavaScript/TypeScript, initialized via Vite. Backend API URL must be configurable via environment variables.
*   **Containerization:** Root-level `docker-compose.yml` file. Running `docker compose up` must spin up the Database, Backend, and Frontend without needing any local installations.

---

## 7. API Specifications
*   **Base URL:** `http://localhost:8080`
*   **Headers:** All requests requiring user context must include `X-Student-Id: <17-character-ID>`.
*   **Contract:** Endpoints, paths, and response fields must strictly adhere to the following (extra fields are allowed, but fields must not be omitted or renamed):

### 7.1 Create Class
*   `POST /classes`
*   **Request:** `{ "name": "Class 6 - Morning Shift", "totalSeats": 120 }`
*   **Response (201):** `{ "id": "c_123", "name": "Class 6 - Morning Shift", "totalSeats": 120 }`

### 7.2 List All Classes
*   `GET /classes`
*   **Response (200):** `[ { "id": "c_123", "name": "Class 6 - Morning Shift", "totalSeats": 120, "heldSeats": 15, "confirmedSeats": 80, "availableSeats": 25 } ]`

### 7.3 Get Specific Class
*   `GET /classes/{classId}`
*   **Response (200):** `{ "id": "c_123", "name": "Class 6 - Morning Shift", "totalSeats": 120, "heldSeats": 15, "confirmedSeats": 80, "availableSeats": 25 }`

### 7.4 Apply / Hold Seat
*   `POST /classes/{classId}/holds`
*   **Headers:** `X-Student-Id`
*   **Response (201):** `{ "holdId": "h_789", "classId": "c_123", "studentId": "20152691234567890", "status": "HELD", "expiresAt": "2026-11-01T04:10:00Z" }`
*   **Error (409):** Returned if seats are full.

### 7.5 Get Hold Status
*   `GET /holds/{holdId}`
*   **Response (200):** `{ "holdId": "h_789", "classId": "c_123", "status": "HELD", "expiresAt": "2026-11-01T04:10:00Z" }`
*   *Status values:* `HELD`, `CONFIRMED`, `EXPIRED`, `CANCELLED`.

### 7.6 Confirm Admission
*   `POST /holds/{holdId}/confirm`
*   **Headers:** `X-Student-Id`
*   **Response (200):** `{ "holdId": "h_789", "status": "CONFIRMED" }`

### 7.7 Cancel Application
*   `DELETE /holds/{holdId}`
*   **Headers:** `X-Student-Id`
*   **Response:** `204 No Content` (on success).

### 7.8 Get My Applications
*   `GET /me/holds`
*   **Headers:** `X-Student-Id`
*   **Response (200):** `[ { "holdId": "h_789", "classId": "c_123", "className": "Class 6 - Morning Shift", "status": "HELD", "expiresAt": "2026-11-01T04:10:00Z" } ]`

---

## 8. Error Handling Requirements
*   **Backend:** Proper HTTP status codes (e.g., `409 Conflict` for full seats, `400 Bad Request` for invalid inputs, `404 Not Found`).
*   **Frontend:** Errors (Seats full, Hold expired, Invalid input, Server down) must be displayed in user-friendly language. Blank pages or errors only in the console are unacceptable.

---

## 9. Deliverables & Testing Requirements
The project must be submitted as a public GitHub repository with a meaningful commit history (no single massive commit at the end).

### 9.1 Repository Structure
*   `/backend` (C# .NET code + Dockerfile)
*   `/frontend` (React code + Dockerfile)
*   `docker-compose.yml` (Root)
*   `README.md` (Instructions on how to run via Docker, frontend URL, and how to run tests).
*   `ASSUMPTIONS.md` (Documentation of assumptions made where the spec was unclear).
*   `AI_USAGE.md` (Documentation of which AI tools were used, where they failed, and how the developer corrected them).

### 9.2 Testing Requirements
*   Minimum of 2 automated backend tests.
*   **Mandatory:** At least 1 concurrency test simulating multiple simultaneous requests to prove the `held + confirmed <= totalSeats` constraint is maintained.
*   **Bonus:** Automated tests for the frontend.