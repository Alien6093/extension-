# Save LinkedIn investment posts to Google Sheets

The extension's "Investment posts in my feed" scanner saves every investment
post it finds to a Google Sheet automatically after each scan. It writes to the
sheet through a small Apps Script web app that you own (`Code.gs` in this
folder), so no Google Cloud project or sign-in setup is needed.

## One-time setup

1. Open the Google Sheet you want the posts in. They go into the **first tab**.
   That tab must be empty, or already have the header row this script writes.
   The script never overwrites a tab that has other headers in row 1.
2. **Extensions → Apps Script**. Delete the sample code and paste in the whole
   of `Code.gs`. The extension popup has a **Copy script** button for this.
3. Click **Deploy → New deployment** → ⚙️ **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**. On a Google Workspace account where "Anyone"
     isn't offered, pick "Anyone within <your domain>" and stay signed in to
     that Google account in Chrome.
4. Click **Deploy**, approve the permission prompt, and copy the **Web app URL**
   (`https://script.google.com/macros/s/…/exec`).
5. In the extension popup, open **📈 Investment posts in my feed**, paste the
   URL under **Connect Google Sheet** and click **Connect**.

Treat the web app URL like a password: anyone who has it can add rows to the
sheet.

If you change `Code.gs` later, publish it again with **Deploy → Manage
deployments → Edit → Version: New version**. This keeps the same URL.

## Columns

| Column | Notes |
| --- | --- |
| Post ID | LinkedIn activity ID of the post. Posts already in the sheet are skipped. |
| Post URL | Link to the post. |
| Author, Author public ID, Author member URN, Author profile URL, Author headline | Who wrote the post. Public ID is the handle in the profile URL. Member URN is LinkedIn's internal ID (only available when the scan used LinkedIn's API). |
| Posted at | When the original post was published. |
| Post content | Text of the original post. |
| Reposted by (+ public ID, member URN, profile URL), Reposted at, Repost comment, Repost ID, Repost URL | Filled when someone reposted the post into your feed. "Reposted at", "Repost comment", "Repost ID" and "Repost URL" are only available when they added their own comment. |
| Link 1 – Link 5 | Links in the post. If there are more than 5, the rest go into Link 5, one per line. |
| Why it was in my feed, Feed reason person URL | e.g. "Rahul Mehta likes this" and Rahul's profile URL. |
| Matched keywords, Score | The investment keywords that matched and the relevance score. |
| Likes, Comments, Reposts | Counts for the original post at the time of the scan. |
| Saved at | When the row was added. |
| Category | Funding opportunity, Form / application (check), Grants & competitions, Funding news, Markets & personal finance, Fundraising & VC insights, or Custom keyword match. |
| Form / application links | Links to Google Forms, Typeform, Tally, Airtable, Jotform, F6S etc. found in the post, including ones hidden behind lnkd.in short links. |
| Why kept | The category, total score and every rule that added points. |

## Updating from the first version (30 columns)

Version 2 of `Code.gs` adds the Category, Form / application links and Why
kept columns. Paste the new `Code.gs` over the old one, save, then
**Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. The
web app URL stays the same. On the next save, the three new headers are added
after "Saved at" in your existing sheet; existing rows are left as they are.
