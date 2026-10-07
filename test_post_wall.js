async function run() {
  const getRes = await fetch("http://127.0.0.1:3000/api/wall");
  const data = await getRes.json();
  console.log("GET cameras:", data.cameras.length);
  if (data.cameras.length > 0) {
    const reversed = [...data.cameras].reverse();
    const postRes = await fetch("http://127.0.0.1:3000/api/wall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cameras: reversed, columns: data.columns, refresh: data.refresh })
    });
    console.log("POST status:", postRes.status);
    const postData = await postRes.text();
    console.log("POST response:", postData);
  }
}
run();
