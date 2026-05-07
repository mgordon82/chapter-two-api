type BuildChapterTwoInviteEmailArgs = {
  inviteLink: string;
  displayName?: string | null;
};

type ChapterTwoInviteEmail = {
  subject: string;
  html: string;
  text: string;
};

export function buildChapterTwoInviteEmail({
  inviteLink,
  displayName
}: BuildChapterTwoInviteEmailArgs): ChapterTwoInviteEmail {
  const safeName =
    typeof displayName === 'string' && displayName.trim().length > 0
      ? displayName.trim()
      : null;

  const greeting = safeName ? `Hi ${escapeHtml(safeName)},` : 'Hello,';
  const subject = 'You’ve been invited to Chapter Two';

  const escapedLink = escapeAttribute(inviteLink);
  const visibleLink = escapeHtml(inviteLink);

  const html = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>${subject}</title>
        </head>
        <body
          style="
            margin:0;
            padding:0;
            background-color:#050505;
            font-family:Arial, Helvetica, sans-serif;
            color:#f3f4f6;
            -webkit-font-smoothing:antialiased;
          "
        >
          <table
            role="presentation"
            width="100%"
            cellspacing="0"
            cellpadding="0"
            border="0"
            style="
              width:100%;
              border-collapse:collapse;
              background-color:#050505;
              margin:0;
              padding:0;
            "
          >
            <tr>
              <td align="center" style="padding:32px 12px;">
                <table
                  role="presentation"
                  width="100%"
                  cellspacing="0"
                  cellpadding="0"
                  border="0"
                  style="
                    width:100%;
                    max-width:720px;
                    border-collapse:separate;
                    background-color:#0a0a0a;
                    border:1px solid #262626;
                    border-radius:24px;
                  "
                >
                  <tr>
                    <td
                      style="
                        padding:24px 28px;
                        border-bottom:1px solid #1f1f1f;
                        background-color:#0a0a0a;
                        border-top-left-radius:24px;
                        border-top-right-radius:24px;
                      "
                    >
                      <table
                        role="presentation"
                        width="100%"
                        cellspacing="0"
                        cellpadding="0"
                        border="0"
                        style="width:100%; border-collapse:collapse;"
                      >
                        <tr>
                          <td
                            style="
                              font-size:14px;
                              line-height:14px;
                              letter-spacing:3px;
                              text-transform:uppercase;
                              font-weight:700;
                              color:#c6d9d5;
                            "
                          >
                            Chapter Two
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
  
                  <tr>
                    <td
                      style="
                        padding:40px 28px 22px;
                        background-color:#0a0a0a;
                      "
                    >
                      <div
                        style="
                          margin:0 0 18px;
                          font-size:42px;
                          line-height:1.05;
                          font-weight:800;
                          color:#f5f5f5;
                        "
                      >
                        Your next chapter starts here
                      </div>
  
                      <div
                        style="
                          width:72px;
                          height:4px;
                          background-color:#4fc7c1;
                          border-radius:999px;
                          font-size:0;
                          line-height:0;
                        "
                      >
                        &nbsp;
                      </div>
                    </td>
                  </tr>
  
                  <tr>
                    <td
                      style="
                        padding:10px 28px 40px;
                        background-color:#0a0a0a;
                        border-bottom-left-radius:24px;
                        border-bottom-right-radius:24px;
                      "
                    >
                      <p
                        style="
                          margin:0 0 22px;
                          font-size:16px;
                          line-height:26px;
                          font-weight:700;
                          color:#f3f4f6;
                        "
                      >
                        ${greeting}
                      </p>
  
                      <p
                        style="
                          margin:0 0 18px;
                          font-size:16px;
                          line-height:28px;
                          color:#d1d5db;
                        "
                      >
                        You’ve been invited to join
                        <span style="font-weight:700; color:#ffffff;">Chapter Two</span>.
                      </p>
  
                      <p
                        style="
                          margin:0 0 30px;
                          font-size:16px;
                          line-height:28px;
                          color:#d1d5db;
                        "
                      >
                        Open your invite below to get started.
                      </p>
  
                      <table
                        role="presentation"
                        cellspacing="0"
                        cellpadding="0"
                        border="0"
                        style="margin:0 0 32px; border-collapse:separate;"
                      >
                        <tr>
                          <td
                            bgcolor="#39c6be"
                            style="
                              background-color:#39c6be;
                              border-radius:999px;
                            "
                          >
                            <a
                              href="${escapedLink}"
                              target="_blank"
                              rel="noopener noreferrer"
                              style="
                                display:inline-block;
                                padding:15px 28px;
                                font-size:15px;
                                line-height:15px;
                                font-weight:800;
                                color:#041312;
                                text-decoration:none;
                                border-radius:999px;
                              "
                            >
                              Open Your Invite
                            </a>
                          </td>
                        </tr>
                      </table>
  
                      <div
                        style="
                          margin:0 0 18px;
                          font-size:13px;
                          line-height:22px;
                          text-transform:uppercase;
                          letter-spacing:1.5px;
                          color:#9ca3af;
                        "
                      >
                        Backup link
                      </div>
  
                      <p
                        style="
                          margin:0 0 30px;
                          font-size:14px;
                          line-height:24px;
                          color:#bfc5cf;
                          word-break:break-word;
                        "
                      >
                        <a
                          href="${escapedLink}"
                          target="_blank"
                          rel="noopener noreferrer"
                          style="
                            color:#8fe1db;
                            text-decoration:underline;
                          "
                        >
                          ${visibleLink}
                        </a>
                      </p>
  
                      <div
                        style="
                          height:1px;
                          background-color:#202020;
                          font-size:0;
                          line-height:0;
                          margin:0 0 22px;
                        "
                      >
                        &nbsp;
                      </div>
  
                      <p
                        style="
                          margin:0;
                          font-size:13px;
                          line-height:22px;
                          color:#8f96a3;
                        "
                      >
                        This invitation was sent by Chapter Two. If you weren’t expecting it,
                        you can safely ignore this email.
                      </p>
                    </td>
                  </tr>
                </table>
  
                <table
                  role="presentation"
                  width="100%"
                  cellspacing="0"
                  cellpadding="0"
                  border="0"
                  style="width:100%; max-width:720px; border-collapse:collapse;"
                >
                  <tr>
                    <td
                      align="center"
                      style="
                        padding:18px 16px 0;
                        font-size:12px;
                        line-height:20px;
                        color:#6b7280;
                      "
                    >
                      Chapter Two
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `;

  const text = `${safeName ? `Hi ${safeName},` : 'Hello,'}
  
  You’ve been invited to join Chapter Two.
  
  Open your invite:
  ${inviteLink}
  
  If you weren’t expecting this email, you can safely ignore it.`;

  return {
    subject,
    html,
    text
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
