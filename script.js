
"use strict";

const CLIENT_ID = "665583016463-9hc2hskgovfcht7t2p0aurqdfni5ut4i.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/drive.file";

const $ = id => document.getElementById(id);
const money = value => new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2
}).format(Number(value) || 0);

let expenses = [];
let spreadsheetId = null;
let tokenClient;
let busy = false;

function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function showStatus(message, type = "") {
  $("status").textContent = message;
  $("status").className = type;
  $("googleStatus").textContent = message;
}

function apiRequest(request) {
  return request.then(result => result.result);
}

async function initialiseGoogle() {
  await new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (window.gapi && window.google?.accounts?.oauth2) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > 15000) {
        clearInterval(timer);
        reject(new Error("Google libraries did not load. Refresh the page and try again."));
      }
    }, 100);
  });

  await new Promise(resolve => gapi.load("client", resolve));
  await gapi.client.init({});
  await gapi.client.load("https://sheets.googleapis.com/$discovery/rest?version=v4");
  await gapi.client.load("https://www.googleapis.com/discovery/v1/apis/drive/v3/rest");

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: async response => {
      if (response.error) {
        showStatus("Google authorization failed: " + response.error, "error");
        return;
      }

      gapi.client.setToken({ access_token: response.access_token });

      try {
        showStatus("Finding your personal expense sheet…");
await findOrCreateSpreadsheet();

$("googleConnect").hidden = true;
$("connectionLabel").textContent = "Connected to your Google Sheet";
$("connectionDot").style.background = "#36b78a";

showStatus("Connected to your Google Sheet. Your expenses are ready.", "success");

await loadExpenses();
      } catch (error) {
        showStatus(error.message || "Could not set up your spreadsheet.", "error");
      }
    }
  });
}

async function connectGoogle() {
  try {
    if (!tokenClient) {
      showStatus("Loading Google sign-in…");
      await initialiseGoogle();
    }
    tokenClient.requestAccessToken({ prompt: "consent" });
  } catch (error) {
    showStatus(error.message, "error");
  }
}

async function findOrCreateSpreadsheet() {
  // Find a spreadsheet created or opened by this app.
  const result = await apiRequest(gapi.client.drive.files.list({
    q: "name = 'My Daily Expenses' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false",
    fields: "files(id,name,createdTime)",
    orderBy: "createdTime desc",
    pageSize: 100
  }));

  if (result.files?.length) {
    spreadsheetId = result.files[0].id;
  } else {
    const created = await apiRequest(gapi.client.sheets.spreadsheets.create({
      properties: { title: "My Daily Expenses" },
      sheets: [{ properties: { title: "Expenses" } }]
    }));

    spreadsheetId = created.spreadsheetId;

    await apiRequest(gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Expenses!A1:H1",
      valueInputOption: "RAW",
      resource: {
        values: [[
          "Date", "Description", "Category", "Amount",
          "Payment Method", "Notes", "Created At", "ID"
        ]]
      }
    }));

    await apiRequest(gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [{
          updateSheetProperties: {
            properties: { sheetId: 0, gridProperties: { frozenRowCount: 1 } },
            fields: "gridProperties.frozenRowCount"
          }
        }]
      }
    }));
  }
}

async function readRows() {
  if (!spreadsheetId) throw new Error("Connect your Google account first.");

  const result = await apiRequest(gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Expenses!A2:H"
  }));

  return result.values || [];
}

async function loadExpenses() {
  if (!spreadsheetId) return;

  try {
    const rows = await readRows();

    expenses = rows.filter(row => row[7]).map(row => ({
      date: String(row[0] || "").slice(0, 10),
      description: String(row[1] || ""),
      category: String(row[2] || ""),
      amount: Number(row[3]) || 0,
      payment: String(row[4] || ""),
      notes: String(row[5] || ""),
      createdAt: String(row[6] || ""),
      id: String(row[7] || "")
    }));

    render();
  } catch (error) {
    showStatus("Could not load expenses: " + error.message, "error");
  }
}

function render() {
  const today = localDate();
  const month = today.slice(0, 7);
  const sum = list => list.reduce((total, e) => total + e.amount, 0);

  $("todayLabel").textContent = new Date().toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short", year: "numeric"
  });

  $("todayTotal").textContent = money(sum(expenses.filter(e => e.date === today)));
  $("monthTotal").textContent = money(sum(expenses.filter(e => e.date.startsWith(month))));
  $("allTotal").textContent = money(sum(expenses));

  const query = $("search").value.trim().toLowerCase();
  const selectedMonth = $("filterMonth").value;
  const category = $("filterCategory").value;

  const filtered = expenses.filter(e => {
    const text = [e.description, e.category, e.payment, e.notes].join(" ").toLowerCase();
    return text.includes(query) &&
      (!selectedMonth || e.date.startsWith(selectedMonth)) &&
      (!category || e.category === category);
  }).sort((a, b) =>
    b.date.localeCompare(a.date) ||
    String(b.createdAt).localeCompare(String(a.createdAt))
  );

  const tbody = $("expenseRows");
  tbody.replaceChildren();

  if (!filtered.length) {
    const row = tbody.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 6;
    cell.className = "empty";
    cell.textContent = "No transactions found. Add your first expense above.";
  }

  filtered.forEach(e => {
    const row = tbody.insertRow();

    const transaction = row.insertCell();
    transaction.textContent = e.description;

    const categoryCell = row.insertCell();
    const pill = document.createElement("span");
    pill.className = "category-pill";
    pill.textContent = e.category;
    categoryCell.appendChild(pill);

    [e.date, e.payment, money(e.amount)].forEach(value => {
      row.insertCell().textContent = value;
    });

    const actionCell = row.insertCell();
    const button = document.createElement("button");
    button.type = "button";
    button.className = "delete-btn";
    button.textContent = "Delete";
    button.addEventListener("click", () => deleteExpense(e.id));
    actionCell.appendChild(button);
  });

  $("recordCount").textContent =
    `${filtered.length} transaction${filtered.length === 1 ? "" : "s"}`;
  $("filteredTotal").textContent = money(sum(filtered));
  $("exportButton").dataset.records = JSON.stringify(filtered);
}

function setBusy(value) {
  busy = value;
  $("saveButton").disabled = value;
  $("refreshButton").disabled = value;
}

async function saveExpense(event) {
  event.preventDefault();
  if (busy) return;

  if (!spreadsheetId) {
    showStatus("Connect your Google account before saving expenses.", "error");
    return;
  }

  const expense = {
    description: $("description").value.trim(),
    amount: Number($("amount").value),
    date: $("date").value,
    category: $("category").value,
    payment: $("payment").value,
    notes: $("notes").value.trim()
  };

  if (!expense.description || !expense.date ||
      !Number.isFinite(expense.amount) || expense.amount <= 0 ||
      expense.amount > 100000000) {
    showStatus("Enter a description, date and valid amount.", "error");
    return;
  }

  setBusy(true);
  showStatus("Saving expense…");

  try {
    const rows = await readRows();
    const id = crypto.randomUUID();

    await apiRequest(gapi.client.sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Expenses!A:H",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      resource: {
        values: [[
          expense.date, expense.description, expense.category,
          expense.amount, expense.payment, expense.notes,
          new Date().toISOString(), id
        ]]
      }
    }));

    $("expenseForm").reset();
    $("date").value = localDate();
    await loadExpenses();
    showStatus("Expense saved successfully.", "success");
  } catch (error) {
    showStatus("Could not save expense: " + error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function deleteExpense(id) {
  if (busy || !confirm("Permanently delete this expense?")) return;

  setBusy(true);
  showStatus("Deleting expense…");

  try {
    const rows = await readRows();
    const index = rows.findIndex(row => String(row[7] || "") === id);
    if (index < 0) throw new Error("Expense not found.");

    // Row 1 is the header, so data index 0 corresponds to sheet row 2.
    await apiRequest(gapi.client.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: 0,
              dimension: "ROWS",
              startIndex: index + 1,
              endIndex: index + 2
            }
          }
        }]
      }
    }));

    await loadExpenses();
    showStatus("Expense deleted.", "success");
  } catch (error) {
    showStatus("Could not delete expense: " + error.message, "error");
  } finally {
    setBusy(false);
  }
}

function exportCSV() {
  const records = JSON.parse($("exportButton").dataset.records || "[]");
  const columns = [
    ["Date", "date"], ["Description", "description"],
    ["Category", "category"], ["Amount", "amount"],
    ["Payment Method", "payment"], ["Notes", "notes"]
  ];
  const quote = value => '"' + String(value ?? "").replace(/"/g, '""') + '"';
  const csv = [
    columns.map(c => quote(c[0])).join(","),
    ...records.map(e => columns.map(c => quote(e[c[1]])).join(","))
  ].join("\r\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `penny-expenses-${localDate()}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("connectGoogle").addEventListener("click", connectGoogle);
$("expenseForm").addEventListener("submit", saveExpense);
$("refreshButton").addEventListener("click", loadExpenses);
$("search").addEventListener("input", render);
$("filterMonth").addEventListener("change", render);
$("filterCategory").addEventListener("change", render);
$("exportButton").addEventListener("click", exportCSV);

$("expenseForm").addEventListener("reset", () => {
  setTimeout(() => { $("date").value = localDate(); }, 0);
});

$("date").value = localDate();
render();
showStatus("Connect Google to create your personal expense sheet.");
