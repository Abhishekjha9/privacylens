import "dotenv/config";

async function run() {
  const baseText = `LinkedIn Privacy Policy. We collect information you provide, usage data, and cookie information to deliver personalized ads and services. We use the term “Designated Countries” to refer to countries in the European Union (EU), European Economic Area (EEA), and Switzerland. LinkedIn shares user data with third-party partners. Data is stored for as long as necessary. Cookie Policy applies to your use of our Services. Multiple tracking scripts are embedded to monitor user activity. Central to this mission is our commitment to be transparent about the data we collect about you, how it is used and with whom it is shared. LinkedIn gathers users’ professional details for networking and job matching. `;
  
  function generateText(targetLength: number) {
    let result = "";
    while (result.length < targetLength) {
      result += baseText;
    }
    return result.slice(0, targetLength);
  }

  // Use the exact observed filtered sizes from the 3000-char run:
  // Privacy Policy: 8037
  // Cookie Policy: 9761
  // User Agreement: 11000
  const docs = [
    { 
      type: "privacy", 
      url: "https://www.linkedin.com/legal/privacy-policy", 
      title: "Privacy Policy", 
      confidence: 0.99,
      extractedText: generateText(8037)
    },
    { 
      type: "cookie", 
      url: "https://www.linkedin.com/legal/cookie-policy", 
      title: "Cookie Policy", 
      confidence: 0.99,
      extractedText: generateText(9761)
    },
    { 
      type: "terms", 
      url: "https://www.linkedin.com/legal/user-agreement", 
      title: "User Agreement", 
      confidence: 0.99,
      extractedText: generateText(11000)
    }
  ];

  console.log("Sending multi-document request...");
  
  const res = await fetch("http://localhost:3000/api/analyze-multi", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documents: docs })
  });

  if (!res.ok) {
    console.error("HTTP " + res.status + " " + await res.text());
    return;
  }
  
  if (!res.body) throw new Error("No body");
  
  console.log("Streaming response...");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let done = false;
  while (!done) {
    const { value, done: readerDone } = await reader.read();
    done = readerDone;
    if (value) {
      const chunk = decoder.decode(value);
      process.stdout.write(chunk);
    }
  }
  console.log("\nFinished!");
}

run().catch(console.error);
