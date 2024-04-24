// file: copyFilesToXMLClipboard.ts

async function copyFilesToXMLClipboard(directoryPath) {
    let xmlContent = `<files>\n`;

    for await (const entry of Deno.readDir(directoryPath)) {
        if (entry.isFile) {
            const filePath = `${directoryPath}/${entry.name}`;
            const fileContents = await Deno.readTextFile(filePath);
            // Escape special XML characters in file contents
            const escapedContents = fileContents;
            xmlContent += `  <file name="${entry.name}">\n    ${escapedContents}\n  </file>\n`;
        }
    }

    xmlContent += `</files>`;

    // Using Deno.run to invoke pbcopy
    const process = Deno.run({
        cmd: ["pbcopy"],
        stdin: "piped",
    });
    await process.stdin.write(new TextEncoder().encode(xmlContent));
    process.stdin.close();
    await process.status(); // Wait for pbcopy to finish
    process.close();
    console.log("Copied XML content to clipboard");
}

// Replace '/path/to/directory' with the actual directory path
copyFilesToXMLClipboard("./dspl/examples");
