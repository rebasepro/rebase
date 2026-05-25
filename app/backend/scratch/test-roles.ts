import jwt from "jsonwebtoken";

const secret = "gvnlBwj9dznFCOsqF5CGTlsQTvGbbNjnmrygRKXSbiohN05yYpkdiyUJ5orMK1Ie";
const token = jwt.sign({ userId: "f06be7ca-a726-4a72-be77-c705227ed3c0", roles: ["admin"] }, secret);

console.log("Token:", token);

fetch("http://localhost:3070/api/admin/roles", {
    headers: {
        "Authorization": `Bearer ${token}`
    }
})
.then(res => res.json().then(data => {
    console.log("Response status:", res.status);
    console.log("Response data:", JSON.stringify(data, null, 2));
}))
.catch(err => {
    console.error("Error:", err);
});
