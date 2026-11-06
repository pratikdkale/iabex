<?php
/*
 * IABEX website mailer — configuration
 *
 * Fill in the SMTP details of a mailbox on your domain (e.g. website@iabex.net).
 * Your hosting control panel (cPanel → Email Accounts → Connect Devices) lists them.
 * If 'smtp.host' is left empty, PHP's built-in mail() is used instead
 * (works on most shared hosts, but mail is more likely to land in spam).
 */
return [
    // Where enquiries and job applications are delivered
    'to_enquiry'    => 'info@iabex.net',
    'to_careers'    => 'info@iabex.net',

    // Sender shown on outgoing mail — must be an address on your own domain
    'from_email'    => 'website@iabex.net',
    'from_name'     => 'IABEX Website',

    // Send a short "we received your message" confirmation to the visitor
    'send_ack'      => true,

    'smtp' => [
        'host'     => '',            // e.g. 'mail.iabex.net' or 'smtp.gmail.com'
        'port'     => 465,           // 465 for SSL, 587 for STARTTLS
        'secure'   => 'ssl',         // 'ssl' | 'tls' | ''
        'username' => '',            // e.g. 'website@iabex.net'
        'password' => '',
    ],

    // Resume upload limits
    'max_upload_bytes' => 5 * 1024 * 1024,
    'allowed_ext'      => ['pdf', 'doc', 'docx'],

    // Basic abuse protection: max submissions per IP per window
    'rate_limit'        => 6,
    'rate_window_secs'  => 600,
];
