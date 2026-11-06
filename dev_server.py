#!/usr/bin/env python3
"""
Local preview server for the IABEX website.

    python3 dev_server.py            → http://localhost:8000

Serves the static site and emulates api/send.php so the enquiry and
job-application forms can be tested without PHP. Instead of emailing,
each submission is saved as an .eml file in ./dev-outbox/ (double-click
to open it in Mail, attachment included).

Not used in production — on the live server, api/send.php handles mail.
"""
import json
import os
import re
import sys
from datetime import datetime
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
OUTBOX = os.path.join(ROOT, 'dev-outbox')
MAX_UPLOAD = 5 * 1024 * 1024
EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')

REQUIRED = {
    'enquiry': ['name', 'email', 'message'],
    'application': ['role', 'name', 'email', 'phone', 'location', 'qualification', 'experience', 'notice', 'consent'],
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_POST(self):
        if self.path.split('?')[0] != '/api/send.php':
            return self.send_error(404)
        length = int(self.headers.get('Content-Length', 0))
        if length > MAX_UPLOAD + 200_000:
            return self.reply(413, False, 'Resume is too large. Maximum size is 5 MB.')

        raw = self.rfile.read(length)
        ctype = self.headers.get('Content-Type', '')
        msg = BytesParser(policy=policy.default).parsebytes(
            b'Content-Type: ' + ctype.encode() + b'\r\n\r\n' + raw)

        fields, resume = {}, None
        for part in msg.iter_parts():
            name = part.get_param('name', header='content-disposition')
            if part.get_filename():
                data = part.get_payload(decode=True) or b''
                if data:
                    resume = (part.get_filename(), part.get_content_type(), data)
            elif name:
                fields[name] = part.get_content().strip()

        if fields.get('website'):
            return self.reply(200, True, 'Thank you.')
        kind = fields.get('type')
        if kind not in REQUIRED:
            return self.reply(400, False, 'Unknown form.')
        if any(not fields.get(k) for k in REQUIRED[kind]) or not EMAIL_RE.match(fields.get('email', '')):
            return self.reply(422, False, 'Please complete all required fields.')
        if kind == 'application':
            if not resume:
                return self.reply(422, False, 'Please attach your resume (PDF, DOC or DOCX).')
            if not resume[0].lower().endswith(('.pdf', '.doc', '.docx')):
                return self.reply(422, False, 'Resume must be a PDF, DOC or DOCX file.')

        em = EmailMessage()
        subject = (f"Job application: {fields['role']} — {fields['name']}" if kind == 'application'
                   else f"Quote request: {fields['product']} — {fields['name']}" if fields.get('product')
                   else f"Website enquiry: {fields.get('interest', 'General')} — {fields['name']}")
        em['Subject'] = subject
        em['From'] = 'IABEX Website <website@iabex.net>'
        em['To'] = 'info@iabex.net'
        em['Reply-To'] = fields['email']
        skip = {'type', 'website', 'consent'}
        em.set_content('\n'.join(f'{k}: {v}' for k, v in fields.items() if k not in skip and v))
        if resume:
            maintype, _, subtype = resume[1].partition('/')
            em.add_attachment(resume[2], maintype=maintype or 'application',
                              subtype=subtype or 'octet-stream', filename=resume[0])

        os.makedirs(OUTBOX, exist_ok=True)
        path = os.path.join(OUTBOX, datetime.now().strftime('%Y%m%d-%H%M%S-') + kind + '.eml')
        with open(path, 'wb') as fh:
            fh.write(em.as_bytes())
        print(f'  ✉  saved {os.path.relpath(path, ROOT)}  ({subject})')

        return self.reply(200, True, 'Application submitted. A confirmation has been sent to your email.'
                          if kind == 'application'
                          else 'Thank you — your enquiry has been sent. We will get back to you shortly.')

    def reply(self, status, ok, message):
        body = json.dumps({'ok': ok, 'message': message}).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f'IABEX dev server → http://localhost:{port}   (form emails saved to ./dev-outbox/)')
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
