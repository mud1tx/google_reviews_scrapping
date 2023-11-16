const { chromium } = require("playwright");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const nodemailer = require("nodemailer");
const fs = require("fs").promises;
const express = require("express");
const app = express();
require("dotenv").config();

console.log(process.env.SENDGRID_API_KEY);

app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true })); // to parse form data

app.get("/", (req, res) => {
  // Check if message and isError are present in the query
  const message = req.query.message;
  const isError = req.query.isError === "true";

  // Render the index page with the message and isError flag
  res.render("index", { message: message, isError: isError });
});

app.post("/submit", async (req, res) => {
  const { email, searchTerm } = req.body;
  const browser = await chromium.launch({ headless: false });
  try {
    const page = await browser.newPage();
    await page.goto("https://www.google.com");

    // Search for Burj Khalifa
    // const searchTerm = "PC Jeweller Kanpur";
    await page.getByRole("combobox", { name: "Search" }).click();
    await page.getByRole("combobox", { name: "Search" }).fill(searchTerm);
    await page.getByRole("combobox", { name: "Search" }).press("Enter");

    // Navigate to the reviews section
    try {
      // Wait for the "Google reviews" button to become visible
      await page.waitForSelector("text=Google reviews", {
        state: "visible",
        timeout: 5000,
      });
    } catch (e) {
      throw new Error(
        "Google reviews button not found or page took too long to load"
      );
    }

    // Click the "Google reviews" button
    await page.click("text=Google reviews");
    // await page.click("text=Google reviews");

    // Wait for the reviews to load
    await page.waitForSelector("div.gws-localreviews__google-review");

    // Scroll within the reviews popup
    const reviewsContainerSelector = ".review-dialog-list"; // Adjust this selector if necessary
    await page.waitForSelector(reviewsContainerSelector);

    let lastHeight;
    let count =0;
    while (true) {
      lastHeight = await page.evaluate((selector) => {
        const reviewsContainer = document.querySelector(selector);
        reviewsContainer.scrollBy(0, reviewsContainer.scrollHeight);
        return reviewsContainer.scrollHeight;
      }, reviewsContainerSelector);

      await page.waitForTimeout(2000); // Wait for more reviews to load

      let newHeight = await page.evaluate(
        (selector) => document.querySelector(selector).scrollHeight,
        reviewsContainerSelector
      );

      if (newHeight === lastHeight || count == 5) {
        break; // Break the loop if no more reviews are loaded
      }
      count++;
    }

    // Click 'More' links to expand all reviews
    const moreLinks = await page.$$("a.review-more-link");
    for (const link of moreLinks) {
      if (await link.isVisible()) {
        await link.click();
      }
    }

    // Scrape reviews
    const reviews = await page.$$eval(
      "div.gws-localreviews__google-review",
      (nodes) =>
        nodes.map((n) => ({
          author: n.querySelector(".TSUbDb a")?.innerText || "No author",
          rating: n.querySelector(".PuaHbe span")?.ariaLabel || "No rating",
          review:
            n.querySelector(".review-full-text")?.innerText ||
            n.querySelector("span[data-expandable-section]")?.innerText ||
            "No review",
        }))
    );

    const csvWriter = createCsvWriter({
      path: "reviews.csv",
      header: [
        { id: "author", title: "AUTHOR" },
        { id: "rating", title: "RATING" },
        { id: "review", title: "REVIEW" },
      ],
    });

    // Define CSV Writer
    await csvWriter.writeRecords(reviews);
    console.log("Reviews written to CSV file.");

    // Set up transporter for Nodemailer
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "support@tasklabs.app", // Replace with your email
        pass: "jkvq vyvv jrpl ehxj", // Replace with your email password or app-specific password
      },
    });

    await transporter.sendMail({
      to: email,
      from: "support@tasklabs.app", // Replace with your email
      subject: "Scraped Reviews",
      text: "Please find attached scraped reviews CSV file.",
      attachments: [
        {
          path: "./reviews.csv",
        },
      ],
    });

    console.log("Email sent, deleting CSV file.");
    await fs.unlink("./reviews.csv");
    console.log("CSV file deleted");

    await browser.close();
    res.redirect("/?message=CSV file sent to your email&isError=false");
  } catch (error) {
    await browser?.close(); // Make sure to close the browser if it's open
    res.redirect(
      "/?message=" + encodeURIComponent(error.message) + "&isError=true"
    );
  }
});

app.listen(3000, () => console.log("Server running on http://localhost:3000"));
