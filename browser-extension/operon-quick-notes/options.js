const input = document.getElementById("url");
const msg = document.getElementById("msg");

chrome.storage.sync.get("operonUrl").then(({ operonUrl }) => {
  input.value = operonUrl || "http://localhost:8080";
});

document.getElementById("save").addEventListener("click", async () => {
  try {
    const u = new URL(input.value.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad protocol");
    await chrome.storage.sync.set({ operonUrl: u.origin });
    input.value = u.origin;
    msg.style.color = "#2e7d32";
    msg.textContent = "Saved.";
  } catch {
    msg.style.color = "#c62828";
    msg.textContent = "Enter a valid http(s) URL.";
  }
});
