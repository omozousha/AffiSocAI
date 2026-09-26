# Threads login — credential handoff

The gateway session is headless (Telegram), so `browser_vault_save_login` returns
`prompt_unavailable`: no prompt can reach the user. A password must therefore NOT
be typed by the agent (`fill_input` on `input[type=password]` is forbidden) and
must NOT be pasted into the chat (it lands in chat history and logs).

Run this from any shell as root on this VPS. The password is read from the file
by `hermes vault add`; it is never echoed and never printed back.

## 1 — write the password to a private file (600, owner root)

    umask 077
    printf '%s' 'PASSWORD_THREADS' > /root/.threads-pass
    chmod 600 /root/.threads-pass

## 2 — confirm the file exists (size only, no content)

    stat -c '%n %s bytes mode=%a' /root/.threads-pass

## 3 — save the login into the Hermes vault (reads from the file)

    hermes vault add --kind login \
      --origin https://www.threads.com \
      --label 'Threads — karasu_michi' \
      --identifier karasu_michi \
      --secret-file /root/.threads-pass

If `--secret-file` is unsupported on this build, the interactive form is:

    hermes vault add --kind login
    # origin:  https://www.threads.com
    # label:   Threads — karasu_michi
    # identifier: karasu_michi
    # secret:  <paste — hidden while typing>

## 4 — shred the plaintext file

    shred -u /root/.threads-pass

## 5 — verify (no secret shown)

    hermes vault list

Done. Report back "done" and the browser will finish the Threads login
(username is already filled), then persist the session cookie so publish works.
