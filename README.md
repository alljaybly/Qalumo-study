# Qalumo

Qalumo is an offline-first study companion for South African learners and caregivers. Learner data is saved in IndexedDB on the current device. It has no account, backend, tracking, ads, analytics, or bundled/required AI service. A phone and a laptop keep separate data; learner backups can be moved manually.

Curriculum and practice content is user-provided unless a source is recorded. The small included mathematics practice set is an app-created example, not an official exam or full curriculum. This project does not claim verified CAPS alignment.

## Live app

[Open Qalumo][live-app] — hosted on Cloudflare Pages. The URL is defined in one source-code location, [`src/config.ts`](./src/config.ts); update that constant when the live address changes.

Open the HTTPS link in a compatible browser to use or install Qalumo. On Android Chrome, open the three-dot menu and choose **Install app** or **Add to Home screen**; wording can vary by browser. Keep the device online while opening the app at least once before testing offline.

The app passed simulated desktop-browser offline checks, but installation and offline use have **not** yet been tested on the physical Redmi phone or Windows 10 laptop. These browser checks do not confirm performance on those devices.

Learner data stays in the browser storage on that device and does not sync automatically. To share selected homework, notes, or tests, export a Study library package, transfer the file yourself (for example, through a shared folder), and import it on the other device. Video playback, new web research, and online AI need internet. The optional LLM feature has not been tested end-to-end.

## Windows 10 setup

1. Install a current Node.js LTS release (Node 18 or newer) from [nodejs.org](https://nodejs.org/). npm is included.
2. Open this folder in VS Code.
3. Open **Terminal → New Terminal** and run:

   ```powershell
   npm install
   npm run dev
   ```

4. Open the local address printed by Vite (normally `http://localhost:5173`) in Edge or Chrome.

To make a production build:

```powershell
npm run build
npm run preview
```

The preview address is normally `http://localhost:4173`. The production build registers the service worker; the development server intentionally does not. `localhost` refers only to the device running the server; a laptop's localhost address is not the phone's app address. A local HTTP network address can help check a phone layout temporarily, but it is not the normal installable HTTPS release.

## Test on an Android phone

For a quick layout test, connect the phone and Windows computer to the same Wi-Fi network. In the project terminal run `npm run dev`, find the computer's local IPv4 address with `ipconfig`, and open `http://COMPUTER-IP:5173` in the phone browser. This development connection is HTTP: responsive pages can be checked, but browser security rules do not allow service-worker/offline installation on a LAN IP over plain HTTP.

To install Qalumo, open the [live HTTPS app][live-app] in a compatible browser while online. On Android Chrome, open the three-dot menu, choose **Install app** or **Add to Home screen**, and confirm. Wording varies by browser. Open the app online at least once before checking offline behavior. The app shell and saved local data/resources are intended to work offline; video playback, new web research, and online AI need internet.

On Windows 10, open the [live HTTPS app][live-app] in Chrome or Edge. If offered, choose the install icon in the address bar or the browser menu item such as **Install this site as an app**, then confirm. Launch it later from the Start menu, taskbar, or shortcut created by the browser. Browser wording and availability vary.

### How updates are published

The live static app is hosted on Cloudflare Pages at [qalumo-study.pages.dev][live-app]. To publish an update, run `npm run build`, then check this Qalumo project’s deployment method in the Cloudflare Pages dashboard and publish the new `dist` build using that method.

This repository contains no Cloudflare Pages or GitHub Actions deployment workflow, so automatic deployment from GitHub is not confirmed. If the Pages project uses Direct Upload, upload the new `dist` folder in the dashboard. If it is connected to a Git repository, follow the branch and build settings displayed in Pages and verify the resulting deployment there. Do not assume a Git push publishes an update unless the integration is configured and the deployment succeeds. Check Cloudflare’s current account requirements, plan limits, and pricing; these can change.

The intended physical test targets are an Android 13 Redmi with 4 GB RAM and a MediaTek Helio G85, and a Windows 10 laptop with 6 GB RAM. These are test targets, not verified minimum requirements. Actual performance depends on browser, available memory/storage, and enabled features. Local AI may not run well on the phone. The live build still needs installation/offline testing on these actual devices. A local desktop build or responsive browser preview is not that test.

## What is included

- Learner profile with nickname, Grade R–12, a preferred-language field, and user-entered subjects. The interface itself is in English in this version.
- A built-in **Help / How Qalumo works** guide in the main navigation and top bar, with a start checklist, step-by-step instructions, glossary, offline limits, Android/Windows installation guidance, intended device test targets, and print support. It links to the live app at [`src/config.ts`](./src/config.ts). The current version keeps one learner profile and study record set per browser on a device; it does not switch among multiple learner profiles.
- Assessment add/edit/delete with original marks, app-calculated percentages, dates, optional topics, and notes.
- A prominent **Results → School report results** area for multiple-subject reports across school years and all four terms. Each subject can store an original mark and total, an entered percentage, or a text achievement/comment; topics are optional. Reports can be edited/deleted and are included in full-app backups/restores.
- Report subject/topic trends distinguish recorded report facts from app-generated practice prompts. Prompts are off by default. A caregiver can configure a percentage threshold, see why a numeric result was flagged, edit the report, or dismiss/restore the prompt. No universal pass mark is assumed; text-only achievement results are not numerically flagged.
- Subject averages and recorded-result trends for individual assessments. Optional topic prompts use the caregiver-selected threshold (configured in Results), not a built-in pass mark. A topic is not inferred when it was not entered.
- A small clearly labelled sample practice set, editable caregiver-created sets, choice and short/numeric answers, explanations, scoring, incorrect-answer review, and local practice history. Answer checking is a simple normalized match, not AI; it does not understand synonyms or mark essays.
- **Homework** lets a learner add, view, edit, archive, and delete assignments; saves title, grade, subject, optional due date, source filename/type, text, learner notes, and an editable breakdown. TXT, text-based PDF, and DOCX text extraction run in the browser, with a 20 MB file limit. Extracted text can be reviewed and corrected. Scanned/image-only PDF OCR is not included; if extraction finds no text, paste or type it. File contents are not uploaded.
- Homework has local editable step/question/brainstorm templates and optional, explicitly confirmed AI actions for plain-language explanations, instructions/deliverables, steps, difficult wording, comprehension questions, and brainstorming. Suggestions are not guaranteed answers; learners should follow class instructions and do their own work.
- **Study library** organizes saved text notes and manual study tests by grade, subject, topic, and source. Tests support multiple choice, true/false, and short answer with an answer key or clearly labelled self-marking rubric. Objective answers are scored and mistakes reviewed; self-marked questions are excluded from the numeric score. Learner-created tests can be linked to homework or saved notes.
- Optional AI question drafting uses only one selected homework item or note after user confirmation. Drafts must be reviewed and saved by the user; no complete or authoritative test bank is included. AI features may need internet or a separately configured compatible local service. The optional LLM feature has **not been tested end-to-end in this project** and is not claimed to work offline.
- In **Study library**, select individual homework items, notes, and tests for a versioned **Study library package**. Import previews contents and duplicates, then merges without replacing existing items or learner profile/results. Duplicates can be skipped or kept as separate copies. Review homework text and notes before sharing. Transfer the downloaded file manually (for example, through a permitted Google Drive folder, which needs internet), download it on the other device, then import; Qalumo does not sync in the background.
- Searchable offline text resources with title, subject, grade, topic, and optional source. Caregivers can also add, edit, filter, and delete video links with a source/platform, grade, subject, topic, language, caregiver note, and review status. This library belongs to the device, not a learner profile, so it can be reused by multiple learners. Qalumo does not search for or recommend videos, embed, download, or store video files. Original playback needs internet and an available source link; no captions or curriculum alignment are claimed.
- Separate, versioned **Export video library** / **Import video library** controls in Resources transfer only caregiver-added video records. Import previews valid additions, invalid records, and normalized-URL duplicates before merging; duplicates are skipped, existing links are never overwritten, and learner records are untouched. Re-importing the same file adds no duplicates. This file can be transferred manually between devices; Qalumo does not sync them.
- Separate full-app JSON backup/restore includes learner data, school reports, homework, study tests and history, suggestion criteria, dismissals, and the video library. Full restore warns and requires confirmation because it replaces current learner data and the library on this device. Older backups without school reports, homework, or study-test data are supported with empty defaults; older backups with videos nested under learner data are also supported. AI settings and API keys are not included.
- Optional AI assistant, off by default. Choose **Online API** or **Local compatible service** only if you configure one. Both use an OpenAI-compatible chat-completions endpoint. Online base URLs must use HTTPS. No provider, API key, paid service, or local model is bundled or assumed free.
- Online API keys are held in memory for the current app session only. They are never saved in IndexedDB or included in backups. Provider/model/base URL preferences are saved locally, separately from learner backups.
- **Test connection** sends only a short test prompt, not learner records. Before each online test or question, Qalumo explains that the prompt goes to the configured provider, which may charge fees and has its own data-handling terms.
- Optional AI question actions send only explicitly selected homework/note context and the selected task. Answers are suggestions and should be checked against saved resources. AI does not silently create or automatically mark tests.
- For **Local compatible service**, users must install and run their own compatible service and allow browser requests (CORS). The default address is `http://localhost:1234/v1`. A local model may be impractical on a phone; non-AI Qalumo features remain available.
- A confirmed delete-all action for locally saved data.
- Web app manifest and service worker with an app-shell cache and same-origin file caching. New web research requires internet; offline resource search finds only notes saved in this app.

## Data and privacy

IndexedDB stores the profile, individual assessments, school reports, homework, study tests and practice history, resources, custom practice sets, and video-library records in the current browser profile. AI connection preferences are stored separately and API keys are memory-only; keys are cleared on reload or when AI is turned off. Clearing browser site data can remove local data. Export a full-app backup before changing devices or clearing browser data. Backups exclude AI preferences and API keys. Study-library packages include only items explicitly selected and exclude the learner profile, results, histories, settings, and API keys. Video-library transfer includes only video records. Importing files on another device is manual; data is not synchronized. A public app URL makes the app accessible but does not expose another device's local IndexedDB. Anyone using the same browser profile/device may be able to access its local app data. Online AI requests are sent only after user confirmation. Provider privacy and fees depend on the configured provider; Qalumo cannot guarantee them.

Practice and learning content should be reviewed by a caregiver. Avoid entering sensitive personal information.

## Checks

Run `npm run build` for TypeScript checking and a production Vite build. Then manually check TXT/PDF/DOCX extraction, homework edits/archive/delete, question creation and practice scoring, study-library export privacy/import merge and duplicate choices, full-backup compatibility, and phone/desktop layout. The app has no separate automated test suite in this first version. Simulated desktop-browser offline checks passed; the optional LLM is not tested end-to-end. The live build still needs installation/offline testing on the intended physical Android Redmi and Windows 10 laptop.

[live-app]: https://qalumo-study.pages.dev/
