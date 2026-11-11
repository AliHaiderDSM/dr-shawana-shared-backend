import { Router, type Response } from 'express';
import { companyService } from '../company/company.service';

const EFFECTIVE_DATE = '11 November 2026';
const APP_NAME = 'DSM Clinic';

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

interface Clinic {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
}

async function clinic(): Promise<Clinic> {
  const company = await companyService.get().catch(() => null);
  return {
    name: company?.name?.trim() || 'DSM Clinic',
    phone: company?.phone?.trim() || null,
    email: company?.email?.trim() || null,
    address: company?.address?.trim() || null,
  };
}

function contactList(c: Clinic) {
  return [
    `<li><strong>${escape(c.name)}</strong></li>`,
    c.phone ? `<li>Phone: <a href="tel:${escape(c.phone)}">${escape(c.phone)}</a></li>` : '',
    c.email ? `<li>Email: <a href="mailto:${escape(c.email)}">${escape(c.email)}</a></li>` : '',
    c.address ? `<li>Address: ${escape(c.address)}</li>` : '',
  ].join('');
}

function page(title: string, body: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · ${APP_NAME}</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; line-height: 1.6; color: #1f2933; background: #f7f9f9; margin: 0; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 20px 56px; background: #fff; }
  h1 { color: #0b6e66; font-size: 1.8rem; margin-bottom: 4px; }
  h2 { color: #0b6e66; font-size: 1.15rem; margin-top: 28px; }
  .muted { color: #5f6b76; font-size: 0.92rem; }
  ul, ol { padding-left: 22px; }
  a { color: #0b6e66; }
  .box { border: 1px solid #d5e3e1; background: #f1f8f7; border-radius: 10px; padding: 12px 16px; }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

function send(res: Response, html: string) {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.type('html').send(html);
}

function privacyPolicy(c: Clinic) {
  return page(
    'Privacy policy',
    `<h1>Privacy policy</h1>
<p class="muted">${APP_NAME} app · Effective ${EFFECTIVE_DATE}</p>
<p>This policy explains how ${escape(c.name)} ("the clinic", "we") collects, uses and protects your information when you use the ${APP_NAME} mobile app as a patient, and when doctors of the clinic use the app to care for their patients.</p>

<h2>Information we collect</h2>
<ul>
  <li><strong>Account and contact details:</strong> your name, phone number, age or date of birth, city and country. The clinic creates your account when you register with it; you activate it in the app with a code and may set a password.</li>
  <li><strong>Health information:</strong> your appointments and visit history, consultation notes, prescriptions, blood test results, and the medical records and lab or imaging reports that you or the clinic upload.</li>
  <li><strong>Messages:</strong> chat messages with your doctor, including photos, files and voice messages you send.</li>
  <li><strong>Requests:</strong> the requests you send to the clinic, for example about appointments, medicines or billing.</li>
  <li><strong>Device information:</strong> a notification token so we can tell you about new messages, and basic sign-in information (such as the device name) to keep your account secure.</li>
</ul>
<p>The app does not show advertising, does not use advertising or analytics trackers, and does not collect your location.</p>

<h2>Permissions the app asks for</h2>
<ul>
  <li><strong>Camera and photos:</strong> only when you choose to photograph or upload a report or send a photo in a chat.</li>
  <li><strong>Microphone:</strong> only while you record a voice message in a chat.</li>
  <li><strong>Notifications:</strong> to tell you about new messages from your doctor.</li>
</ul>

<h2>How we use your information</h2>
<ul>
  <li>To provide your medical care: appointments, consultations, prescriptions and follow-up.</li>
  <li>To let you see your own records, prescriptions and reports in the app, and to let you message your doctor.</li>
  <li>To read the test values in lab reports you or the clinic upload, so your doctor can see them in your blood work chart (see "Automated reading of lab reports").</li>
  <li>To answer your requests and to keep the service secure.</li>
</ul>
<p>We do not sell your information and we do not use it for advertising.</p>

<h2>Automated reading of lab reports</h2>
<p>When a lab report is uploaded, it is sent to an artificial intelligence service (Google Gemini or OpenAI, acting for the clinic) to read the test values and prepare a summary for your doctor. Your doctor reviews these results. Imaging scans are not sent for reading.</p>

<h2>Who can see your information</h2>
<ul>
  <li>Doctors and authorised staff of the clinic who need it to care for you. Doctors see only the patients they treat.</li>
  <li>Service providers that run the app for the clinic: cloud hosting and database (Vercel and Supabase), secure file storage (Supabase), push notifications (Expo and Google Firebase Cloud Messaging), and the AI services above. They process data only to provide their service.</li>
  <li>Authorities, when the law requires it.</li>
</ul>
<p>Other patients can never see your information.</p>

<h2>How we protect your information</h2>
<ul>
  <li>All data travels over encrypted connections (HTTPS).</li>
  <li>Your sign-in token is kept in the secure, encrypted storage of your phone.</li>
  <li>Records and files are stored privately and open only through short-lived links after your access is checked.</li>
</ul>
<p>No system is completely secure, but we work to protect your information and review access regularly.</p>

<h2>How long we keep information</h2>
<p>We keep your medical records for as long as needed to care for you and as required for medical record keeping and legal obligations. Messages, uploads and account data are kept while your account is active.</p>

<h2>Your choices and rights</h2>
<ul>
  <li>You can see your records, prescriptions and reports in the app at any time.</li>
  <li>You can ask the clinic to correct your details (Profile → Edit, or a profile correction request).</li>
  <li>You can delete reports you uploaded yourself.</li>
  <li>You can ask us to delete your app account and data. See <a href="/account-deletion">how to delete your account</a>.</li>
</ul>

<h2>Children</h2>
<p>The app is meant for adult patients of the clinic. A parent or guardian should manage the care of a child.</p>

<h2>Changes to this policy</h2>
<p>If we change this policy we will update this page and the date above. Important changes will also be shown in the app.</p>

<h2>Contact us</h2>
<ul>${contactList(c)}</ul>`,
  );
}

function accountDeletion(c: Clinic) {
  return page(
    'Delete your account',
    `<h1>Delete your ${APP_NAME} account</h1>
<p class="muted">${APP_NAME} app by ${escape(c.name)}</p>
<p>You can ask us to delete your ${APP_NAME} app account and the data linked to it at any time.</p>

<h2>Ask from the app</h2>
<ol>
  <li>Open the ${APP_NAME} app and sign in.</li>
  <li>Go to <strong>Profile</strong>.</li>
  <li>Tap <strong>Delete my account</strong> and send the request.</li>
</ol>

<h2>Ask without the app</h2>
<p>Contact the clinic and say that you want your app account deleted. Give your name and the phone number of your account so we can confirm it is you.</p>
<ul>${contactList(c)}</ul>

<h2>What happens next</h2>
<div class="box">
<p><strong>Closed and deleted:</strong> your app account is closed so it can no longer be used to sign in, every signed-in device is signed out, and your notification tokens are deleted. Reports you uploaded yourself can also be deleted on request.</p>
<p><strong>Kept:</strong> your medical records (appointments, consultation notes, prescriptions, test results, reports and messages with your doctor) that the clinic must keep for medical record keeping and legal reasons. They are kept securely and are no longer available through the app.</p>
</div>
<p>We confirm and complete deletion requests within 30 days.</p>
<p>Read our <a href="/privacy">privacy policy</a>.</p>`,
  );
}

export const legalRouter = Router();

legalRouter.get(['/privacy', '/privacy-policy'], async (_req, res) => {
  send(res, privacyPolicy(await clinic()));
});

legalRouter.get(['/account-deletion', '/delete-account'], async (_req, res) => {
  send(res, accountDeletion(await clinic()));
});
