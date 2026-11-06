<?php
/*
 * IABEX website mailer
 * POST endpoint used by the enquiry form, product quote form and job application form.
 * Responds with JSON: { "ok": bool, "message": string }
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

$config = require __DIR__ . '/config.php';

function respond(int $status, bool $ok, string $message): void
{
    http_response_code($status);
    echo json_encode(['ok' => $ok, 'message' => $message]);
    exit;
}

function field(string $key, int $max = 500): string
{
    $v = isset($_POST[$key]) && is_string($_POST[$key]) ? trim($_POST[$key]) : '';
    return mb_substr($v, 0, $max);
}

/* Single-line values must never contain line breaks (header injection). */
function line(string $key, int $max = 200): string
{
    return str_replace(["\r", "\n"], ' ', field($key, $max));
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, false, 'Method not allowed.');
}

// Honeypot — real visitors never fill this hidden field
if (field('website') !== '') {
    respond(200, true, 'Thank you.');
}

/* ── Rate limit per IP ── */
$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$rlFile = sys_get_temp_dir() . '/iabex_rl_' . md5($ip);
$now = time();
$hits = [];
if (is_file($rlFile)) {
    $hits = array_filter(
        (array) json_decode((string) file_get_contents($rlFile), true),
        fn($t) => is_int($t) && $t > $now - $config['rate_window_secs']
    );
}
if (count($hits) >= $config['rate_limit']) {
    respond(429, false, 'Too many submissions. Please try again in a few minutes.');
}
$hits[] = $now;
@file_put_contents($rlFile, json_encode(array_values($hits)), LOCK_EX);

/* ── Build the message for each form type ── */
$type = field('type', 20);
$attachment = null;

if ($type === 'enquiry') {
    $name    = line('name');
    $email   = line('email');
    $message = field('message', 5000);
    if ($name === '' || $message === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(422, false, 'Please fill in your name, a valid email and your message.');
    }
    $product = line('product');
    $subject = $product !== ''
        ? "Quote request: {$product} — {$name}"
        : 'Website enquiry: ' . (line('interest') ?: 'General') . " — {$name}";
    $rows = [
        'Product'   => $product,
        'Interest'  => line('interest'),
        'Quantity'  => line('quantity', 40),
        'Name'      => $name,
        'Company'   => line('company'),
        'Email'     => $email,
        'Phone'     => line('phone', 40),
        'Message'   => $message,
    ];
    $to = $config['to_enquiry'];
    $ackSubject = 'We received your enquiry — IABEX Technologies';
    $ackBody = "Dear {$name},\n\nThank you for contacting IABEX Technologies. Our team has received your "
        . ($product !== '' ? "quote request for the {$product}" : 'enquiry')
        . " and will get back to you shortly.\n\nRegards,\nIABEX Technologies\nhttps://iabex.net";

} elseif ($type === 'application') {
    $required = ['role', 'name', 'email', 'phone', 'location', 'qualification', 'experience', 'notice'];
    foreach ($required as $key) {
        if (line($key) === '') {
            respond(422, false, 'Please complete all required fields.');
        }
    }
    $email = line('email');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(422, false, 'Please enter a valid email address.');
    }
    if (field('consent', 5) === '') {
        respond(422, false, 'Please confirm the declaration to submit your application.');
    }

    // Resume upload
    $f = $_FILES['resume'] ?? null;
    if (!$f || ($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) {
        respond(422, false, 'Please attach your resume (PDF, DOC or DOCX).');
    }
    if ($f['size'] > $config['max_upload_bytes']) {
        respond(422, false, 'Resume is too large. Maximum size is 5 MB.');
    }
    $ext = strtolower(pathinfo((string) $f['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, $config['allowed_ext'], true)) {
        respond(422, false, 'Resume must be a PDF, DOC or DOCX file.');
    }
    $mimes = [
        'pdf'  => 'application/pdf',
        'doc'  => 'application/msword',
        'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (function_exists('finfo_open')) {
        $detected = (string) finfo_file(finfo_open(FILEINFO_MIME_TYPE), $f['tmp_name']);
        $okTypes = [$mimes[$ext], 'application/zip', 'application/octet-stream', 'application/x-ole-storage', 'application/CDFV2'];
        if (!in_array($detected, $okTypes, true)) {
            respond(422, false, 'The uploaded file does not look like a valid resume document.');
        }
    }
    $name = line('name');
    $safeName = preg_replace('/[^A-Za-z0-9]+/', '_', $name) ?: 'Applicant';
    $attachment = [
        'filename' => "Resume_{$safeName}.{$ext}",
        'mime'     => $mimes[$ext],
        'data'     => (string) file_get_contents($f['tmp_name']),
    ];

    $role = line('role');
    $subject = "Job application: {$role} — {$name}";
    $rows = [
        'Role'                   => $role,
        'Name'                   => $name,
        'Email'                  => $email,
        'Phone'                  => line('phone', 40),
        'Current location'       => line('location'),
        'Highest qualification'  => line('qualification'),
        'Total experience (yrs)' => line('experience', 10),
        'Current / last employer'=> line('employer'),
        'Notice period'          => line('notice'),
        'Current CTC'            => line('current_ctc', 40),
        'Expected CTC'           => line('expected_ctc', 40),
        'Key skills'             => field('skills', 1000),
        'LinkedIn / portfolio'   => line('linkedin', 300),
        'Cover note'             => field('cover', 5000),
    ];
    $to = $config['to_careers'];
    $ackSubject = 'Application received — IABEX Technologies';
    $ackBody = "Dear {$name},\n\nThank you for applying for the {$role} position at IABEX Technologies. "
        . "We have received your application and resume. If your profile matches our requirements, "
        . "our team will contact you.\n\nRegards,\nIABEX Technologies\nhttps://iabex.net";

} else {
    respond(400, false, 'Unknown form.');
}

$rows = array_filter($rows, fn($v) => $v !== '');

/* ── Compose ── */
$text = $subject . "\n" . str_repeat('-', 40) . "\n";
$html = '<div style="font-family:Arial,Helvetica,sans-serif;color:#16181b;max-width:640px">'
      . '<div style="border-top:4px solid #ed2024;padding:18px 0 8px"><strong style="font-size:18px">'
      . htmlspecialchars($subject) . '</strong></div>'
      . '<table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px">';
foreach ($rows as $label => $value) {
    $text .= "{$label}: {$value}\n";
    $html .= '<tr><td style="border-bottom:1px solid #e6e6e3;color:#5d6066;width:180px;vertical-align:top">'
           . htmlspecialchars($label) . '</td><td style="border-bottom:1px solid #e6e6e3">'
           . nl2br(htmlspecialchars($value)) . '</td></tr>';
}
$html .= '</table><p style="color:#9a9ca0;font-size:12px;margin-top:18px">Sent from the iabex.net website form.</p></div>';

try {
    send_mail($config, $to, $subject, $text, $html, $email, $attachment);
} catch (Throwable $e) {
    error_log('[iabex mailer] ' . $e->getMessage());
    respond(500, false, 'We could not send your message right now. Please email info@iabex.net directly.');
}

if ($config['send_ack']) {
    try {
        send_mail($config, $email, $ackSubject, $ackBody, null, null, null);
    } catch (Throwable $e) {
        error_log('[iabex mailer] ack failed: ' . $e->getMessage());
    }
}

respond(200, true, $type === 'application'
    ? 'Application submitted. A confirmation has been sent to your email.'
    : 'Thank you — your enquiry has been sent. We will get back to you shortly.');


/* ======================================================================
   Mail helpers
   ====================================================================== */

function encode_header(string $s): string
{
    return preg_match('/[^\x20-\x7E]/', $s) ? '=?UTF-8?B?' . base64_encode($s) . '?=' : $s;
}

function send_mail(array $c, string $to, string $subject, string $text, ?string $html, ?string $replyTo, ?array $file): void
{
    $eol = "\r\n";
    $boundary = 'b1_' . bin2hex(random_bytes(12));
    $alt      = 'b2_' . bin2hex(random_bytes(12));
    $domain   = substr(strrchr($c['from_email'], '@') ?: '@iabex.net', 1);

    $headers  = 'Date: ' . date('r') . $eol;
    $headers .= 'From: ' . encode_header($c['from_name']) . " <{$c['from_email']}>" . $eol;
    if ($replyTo) {
        $headers .= "Reply-To: {$replyTo}" . $eol;
    }
    $headers .= 'Message-ID: <' . bin2hex(random_bytes(16)) . "@{$domain}>" . $eol;
    $headers .= 'MIME-Version: 1.0' . $eol;

    // text + optional html alternative
    $altPart = $html === null
        ? 'Content-Type: text/plain; charset=UTF-8' . $eol . 'Content-Transfer-Encoding: base64' . $eol . $eol
          . chunk_split(base64_encode($text))
        : "Content-Type: multipart/alternative; boundary=\"{$alt}\"" . $eol . $eol
          . "--{$alt}" . $eol . 'Content-Type: text/plain; charset=UTF-8' . $eol
          . 'Content-Transfer-Encoding: base64' . $eol . $eol . chunk_split(base64_encode($text))
          . "--{$alt}" . $eol . 'Content-Type: text/html; charset=UTF-8' . $eol
          . 'Content-Transfer-Encoding: base64' . $eol . $eol . chunk_split(base64_encode($html))
          . "--{$alt}--" . $eol;

    if ($file) {
        $headers .= "Content-Type: multipart/mixed; boundary=\"{$boundary}\"" . $eol;
        $body = "--{$boundary}" . $eol . $altPart
              . "--{$boundary}" . $eol
              . "Content-Type: {$file['mime']}; name=\"{$file['filename']}\"" . $eol
              . 'Content-Transfer-Encoding: base64' . $eol
              . "Content-Disposition: attachment; filename=\"{$file['filename']}\"" . $eol . $eol
              . chunk_split(base64_encode($file['data']))
              . "--{$boundary}--" . $eol;
    } else {
        // Hoist the part's own headers into the message headers
        [$partHeaders, $partBody] = explode($eol . $eol, $altPart, 2);
        $headers .= $partHeaders . $eol;
        $body = $partBody;
    }

    if (!empty($c['smtp']['host'])) {
        $data = 'To: ' . $to . $eol . 'Subject: ' . encode_header($subject) . $eol . $headers . $eol . $body;
        smtp_send($c['smtp'], $c['from_email'], $to, $data);
        return;
    }

    if (!mail($to, encode_header($subject), $body, rtrim($headers), '-f' . $c['from_email'])) {
        throw new RuntimeException('mail() returned false');
    }
}

function smtp_send(array $s, string $from, string $to, string $data): void
{
    $remote = ($s['secure'] === 'ssl' ? 'ssl://' : 'tcp://') . $s['host'] . ':' . (int) $s['port'];
    $fp = @stream_socket_client($remote, $errno, $errstr, 20);
    if (!$fp) {
        throw new RuntimeException("SMTP connect failed: {$errstr} ({$errno})");
    }
    stream_set_timeout($fp, 20);

    $read = function () use ($fp): array {
        $resp = '';
        while (($line = fgets($fp, 515)) !== false) {
            $resp .= $line;
            if (strlen($line) < 4 || $line[3] === ' ') {
                break;
            }
        }
        return [(int) substr($resp, 0, 3), $resp];
    };
    $cmd = function (?string $line, array $expect) use ($fp, $read): void {
        if ($line !== null) {
            fwrite($fp, $line . "\r\n");
        }
        [$code, $resp] = $read();
        if (!in_array($code, $expect, true)) {
            throw new RuntimeException('SMTP error: ' . trim($resp));
        }
    };

    $host = gethostname() ?: 'localhost';
    $cmd(null, [220]);
    $cmd("EHLO {$host}", [250]);
    if ($s['secure'] === 'tls') {
        $cmd('STARTTLS', [220]);
        if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
            throw new RuntimeException('STARTTLS negotiation failed');
        }
        $cmd("EHLO {$host}", [250]);
    }
    if ($s['username'] !== '') {
        $cmd('AUTH LOGIN', [334]);
        $cmd(base64_encode($s['username']), [334]);
        $cmd(base64_encode($s['password']), [235]);
    }
    $cmd("MAIL FROM:<{$from}>", [250]);
    $cmd("RCPT TO:<{$to}>", [250, 251]);
    $cmd('DATA', [354]);
    // Dot-stuffing per RFC 5321
    $data = preg_replace('/^\./m', '..', $data);
    $cmd($data . "\r\n.", [250]);
    $cmd('QUIT', [221]);
    fclose($fp);
}
