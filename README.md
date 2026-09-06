# 🏫 School Exam Analytics System

A full-stack web application for schools to record exam marks, generate class
broadsheets, print multi-exam reports and auto-generate timetables.

**Stack:** Node.js · Express.js · PostgreSQL (`pg`) · Vanilla HTML/CSS/JS ·
Session auth (`express-session` + `bcryptjs`) · `sharp` for logo resizing ·
`node-cache` for API caching.

---

## ✨ Features

### First-run Setup Wizard (6 steps)
When the database is empty the app redirects to a guided wizard:

1. **School information** – name, motto, address, logo (PNG/JPG, auto-resized
   to max 300×300 via `sharp`), primary & secondary colours, admin
   username/password, and a **site-access password** for teachers.
2. **Academic structure** – academic year, number of terms (2 or 3), exams per
   term (Mid / End / Both), and a toggle to mark **Term 3 Mid Term optional**.
3. **Register classes** – class name + optional stream, multiple streams per grade.
4. **Register subjects** – pre-loaded defaults (ENG, KIS, MATHS, IS, P/T,
   AGRIC, SST, CRE, CAS), add/edit/remove, and a configurable grading rubric.
5. **Register teachers** – name, username, password, max periods/week, subject
   and class assignments, class-teacher designation and Head of Institution.
6. **Register students** – manual entry or **CSV bulk import** (downloadable template).

Everything remains editable from the **Admin panel** afterwards.

### Modules
- **Admin panel** – school info & logo, exams (activate / open entry / publish),
  classes, subjects, teachers, students (incl. CSV import), period times, rubric.
- **Marks entry** – teacher selects class + subject (filtered to their
  assignments); active exam preselected; live rubric badge; "out of" conversion.
- **Class broadsheet** – pivot of marks per class/exam with TT MKS, POINTS,
  AVG and POS (with the specified tie-break). Sortable, searchable, printable.
- **Multi-exam report** – A4 printable report with three modes: single exam,
  term average (Mid + End + Average), and year-end average (T1/T2/T3 + Year
  average). P/L and position always based on the final/average score. Includes
  a career-pathway graph, remarks, signature lines, holiday note, watermark and
  page border.
- **Data viewer** – mark-list tab + broadsheet/performance tab. Printable.
- **Timetable** – auto-generate and manual edit, with class / teacher / block
  views. Printable.

---

## 📁 Project structure

```
school-exam-analytics/
├── server.js                 # Express app: session, static, routes
├── package.json
├── .env.example
├── .gitignore
├── database/
│   └── schema.sql            # Full PostgreSQL schema
├── scripts/
│   ├── db-init.js            # npm run db:init
│   ├── db-seed.js            # npm run db:seed  (sample data)
│   └── db-reset.js           # npm run db:reset (drop + re-init)
├── src/
│   ├── db.js                 # PostgreSQL connection pool
│   ├── cache.js              # node-cache instance
│   ├── middleware/
│   │   └── auth.js           # requireLogin / requireAdmin
│   ├── routes/               # API route handlers
│   │   ├── init.js setup.js upload.js auth.js school.js
│   │   ├── classes.js subjects.js teachers.js students.js exams.js
│   │   ├── marks.js broadsheet.js report.js timetable.js periods.js
│   └── utils/
│       ├── grading.js        # rubric + grade helper
│       ├── broadsheet.js     # broadsheet computation
│       ├── report.js         # multi-exam report builder
│       └── school.js         # school/config helpers
└── public/
    ├── css/style.css         # global stylesheet (uses --primary/--secondary)
    ├── js/app.js             # shared client helpers + nav/theme
    ├── uploads/              # uploaded school logo (gitignored)
    ├── login.html            # login (staff or site password)
    ├── setup.html            # 6-step first-run wizard
    ├── index.html            # dashboard
    ├── admin.html            # admin panel
    ├── marks.html            # marks entry
    ├── broadsheet.html       # class broadsheet
    ├── report.html           # A4 multi-exam report
    ├── data.html             # data viewer
    ├── timetable.html        # timetable generator/editor
    └── timetable-view.html   # timetable views
```

---

## 🚀 Installation

### 1. Prerequisites

- **Node.js** ≥ 18
- **PostgreSQL** ≥ 13

### 2. Install dependencies

```bash
cd school-exam-analytics
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```ini
PORT=3000
DATABASE_URL=postgres://exam:examsecret@localhost:5432/exam_db
SESSION_SECRET=a-long-random-string
NODE_ENV=development
INIT_CACHE_TTL=300
```

### 4. Prepare the database

```bash
# Create the database + a role to match DATABASE_URL, e.g.:
#   sudo -u postgres psql -c "CREATE ROLE exam WITH LOGIN PASSWORD 'examsecret' SUPERUSER;"
#   sudo -u postgres psql -c "CREATE DATABASE exam_db OWNER exam;"

npm run db:init    # applies database/schema.sql (idempotent)
```

**Optional — load sample data for a quick demo:**

```bash
npm run db:seed
#   Admin   → username: admin   password: admin123
#   Teacher → username: teacher1..teacher4  password: teach123
#   Site password: teach123
```

**Reset the database (development only):**

```bash
npm run db:reset   # drops all tables, then re-applies schema.sql
```

### 5. Run the app

```bash
npm start           # production: node server.js
npm run dev         # development: nodemon server.js (watch mode)
```

Open **http://localhost:3000**.

- If the database is empty you'll be taken to the **setup wizard**.
- Otherwise, log in as an admin/teacher (or use the site-access password).

---

## 🔐 Authentication

- **Admin / teacher** log in with their personal username + password
  (stored as `bcrypt` hashes).
- **Teachers** may also log in with the shared **site-access password**
  configured during setup (also stored as a bcrypt hash).
- Every page except `/login` and `/setup` is protected by session middleware.
- `/api/init` is public (used to theme the login/setup screens) and is cached
  for 5 minutes via `node-cache`.

---

## 🧭 API reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/setup` | Complete first-run setup (all wizard data) |
| POST | `/api/upload/logo` | Upload & resize school logo (multipart, `sharp`) |
| POST | `/api/auth/login` | User login (username + password) |
| POST | `/api/auth/login-site` | Teacher site-access-password login |
| GET | `/api/auth/me` | Current session user |
| POST | `/api/auth/logout` | Destroy the session |
| GET | `/api/init` | System state + school info (cached 5 min) |
| GET/PUT | `/api/school` | Read / update school details |
| GET/POST | `/api/classes` · DELETE `/api/classes/:id` | Manage classes |
| GET/POST | `/api/subjects` · PUT/DELETE `/api/subjects/:id` | Manage subjects |
| GET/POST | `/api/teachers` · PUT/DELETE `/api/teachers/:id` | Manage teachers |
| GET | `/api/students` · `/api/students/by-class/:id` | List students |
| POST | `/api/students` · `/api/students/import` (CSV) · DELETE `/api/students/:id` | Manage students |
| GET | `/api/exams` · `/api/exams/active` | List / active exam |
| PUT | `/api/exams/:id` | Activate, open/close entry, publish |
| GET | `/api/marks/:classId/:subjectId/:examId` | Marks grid for entry |
| POST | `/api/marks` | Batch save marks |
| GET | `/api/broadsheet/:classId/:examId` | Pivot broadsheet + subject analysis |
| GET | `/api/report/:studentId` | Multi-exam report (mode/term/exam/year) |
| GET/POST | `/api/timetable/:classId/:termId` | Get / save class timetable |
| POST | `/api/timetable/generate` | Auto-generate timetables |
| GET | `/api/timetable/teacher/:teacherId/:termId` | Teacher timetable |
| GET/PUT | `/api/periods` | Period times & breaks |

---

## 🎨 Theming

School colours are loaded from the database into CSS variables
`--primary` and `--secondary` at runtime (`public/js/app.js`), so the whole UI
and printed reports take the school's colours. The school logo is shown in every
header and on printed reports, loaded from `/public/uploads/logo.png`.

---

## 🖨 Printing

Every page includes print CSS. Use the **Print** button on the broadsheet,
report, data viewer and timetable pages to produce A4-formatted output. The
report page uses a bordered A4 layout with a watermark, signature lines and a
career-pathway graph.

---

## 📝 Grading rubric

The default rubric (configurable per subject or globally) is:

| Band | Range | Points |
|------|-------|--------|
| BE2  | 0–9    | 5  |
| BE1  | 10–19  | 6  |
| AE2  | 20–29  | 7  |
| AE1  | 30–39  | 8  |
| ME2  | 40–56  | 9  |
| ME1  | 57–74  | 10 |
| EE2  | 75–89  | 11 |
| EE1  | 90–100 | 12 |

Positions are computed **server-side** using:

```
1 + COUNT(points > mine) + COUNT(points = mine AND ttmks > mine)
```

---

## ⚠️ Notes

- This app uses the default in-memory session store. For production behind
  multiple instances, configure a shared session store (e.g. `connect-pg-simple`).
- Set `cookie.secure = true` in `server.js` if you serve over HTTPS.
- `public/uploads/` (logo) and `node_modules/` are gitignored.

---

## 📤 Putting it on GitHub

The project is git-ready and **`.env` / `node_modules` / `public/uploads` are
already excluded** by `.gitignore`, so it's safe to push.

**Create an empty repo** at https://github.com/new — do **not** tick "Add a
README" / ".gitignore" / "license" (that avoids a merge conflict).

Then, from the project folder, either use the helper script:

```bash
bash push.sh        # prompts for your repo URL and pushes for you
```

…or run the commands manually:

```bash
git remote add origin https://github.com/YOUR_USERNAME/REPO_NAME.git
git branch -M main
git push -u origin main
```

**GitHub authentication (the usual cause of being "stuck"):** GitHub no longer
accepts your account password for `git push`. When it asks for a password, use a
**Personal Access Token** instead:

1. GitHub → **Settings → Developer settings → Personal access tokens →
   Tokens (classic) → Generate new token (classic)**.
2. Scope: check **repo**.
3. Copy the token, use it as the password when prompted.

> **Note:** the initial commit was authored as a placeholder identity
> (`School Exam Analytics <dev@example.com>`) because I don't have your GitHub
> username. To credit yourself before pushing:
> ```bash
> git config user.name "Your Name"
> git config user.email "you@example.com"
> git commit --amend --reset-author --no-edit
> ```

### Getting a live URL from the repo

GitHub **cannot** run a Node + PostgreSQL app on Pages (static only), so to
"open the app from GitHub" you need one of:

| Option | What it is | Why |
|--------|-----------|-----|
| **GitHub Codespaces** | In-browser dev environment on the repo page (**Code ▸ Codespaces ▸ Create codespace**) | Runs the app + a dev database; closest to "open in browser" |
| **Render / Railway / Fly / Heroku** | Cloud host that auto-builds on push | Gives a permanent public URL; needs a managed PostgreSQL |
| **Local clone** | `git clone` then `npm install` on your machine | Full control, needs your own Postgres |

The app needs a `DATABASE_URL` (hosted Postgres or local) to run.

---

## 🟢 Open it in GitHub Codespaces (recommended)

This repo ships with a ready-made **Dev Container** that provisions **Node 20
and PostgreSQL 15** automatically, seeds sample data, and starts the app.

**Steps (no terminal needed on your end):**

1. Open your repo on github.com.
2. Click the green **Code** button → **Codespaces** tab → **Create codespace
   on `main`**.
3. Wait 1–3 minutes while it builds (installs PostgreSQL, runs `db:init`
   + `db:seed`). You'll see the log in the terminal.
4. When it finishes, a notification appears ("Your application is running on
   port 3000") — click **Open in Browser**, or open the **Ports** panel and
   click the globe next to port **3000**.

You'll land on the login page. **Demo logins:**

```
Admin   → username: admin   password: admin123
Teacher → username: teacher1..teacher4  password: teach123
Site    → password: teach123
```

> **Want a clean database for your own school?** In the Codespace terminal run
> `npm run db:reset`, then visit the site — you'll be taken to the setup wizard.

**What got added for Codespaces:**

- `.devcontainer/devcontainer.json` — creates the environment, forwards port 3000.
- `.devcontainer/Dockerfile` — Node 20 dev image.
- `.devcontainer/setup.sh` — `npm install`, waits for Postgres, `db:init`, `db:seed`.
- `docker-compose.yml` — PostgreSQL 15 sidecar + the app, wired via `DATABASE_URL`.
- `.dockerignore` — keeps the build context light and secrets out.

If you edit locally with **VS Code**, opening the folder prompts to "Reopen in
Container" using the same config.


