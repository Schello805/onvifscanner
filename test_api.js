async function run() {
  const getRes = await fetch("http://127.0.0.1:3000/api/wall");
  const data = await getRes.json();
  console.log("Initial cameras order:", data.cameras.map(c => c.id));
  
  if (data.cameras.length < 2) {
    console.log("Need at least 2 cameras to test reordering.");
    return;
  }
  
  const reversed = [...data.cameras].reverse();
  const postRes = await fetch("http://127.0.0.1:3000/api/wall", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cameras: reversed, columns: data.columns, refresh: data.refresh })
  });
  console.log("POST status:", postRes.status);
  
  const getRes2 = await fetch("http://127.0.0.1:3000/api/wall");
  const data2 = await getRes2.json();
  console.log("New cameras order:", data2.cameras.map(c => c.id));
}
run();
