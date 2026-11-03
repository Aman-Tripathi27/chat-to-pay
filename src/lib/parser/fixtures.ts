// Sample chats with the order a careful seller would write down for each.
// The first 30 were written while building the reader; the next 8 ("unseen") were written
// afterwards and passed without changes; the last 8 ("batch 3") were written afterwards too and
// led to four fixes (house numbers, "send to", Devanagari words, one-word names). Used by accuracy.test.ts.

import type { Language, ShopInput } from "./index";

export const SHOP: ShopInput = {
  name: "Priya's Kurti Studio",
  catalog: [
    "Blue cotton kurti - ₹799 (sizes S, M, L, XL)",
    "Pink anarkali kurti - ₹1,199 (sizes M, L)",
    "Printed dupatta - ₹349",
    "Delivery: ₹60 per order, free above ₹1,500",
  ].join("\n"),
  policies: [
    "No COD, prepaid only (UPI or card).",
    "Dispatch within 2 days of payment, delivery 4-6 days.",
    "Exchange within 7 days for size issues, no returns.",
  ].join("\n"),
};

export interface Fixture {
  name: string;
  chat: string;
  shop?: ShopInput;
  /** [product, size, quantity, unit price] */
  items: [string, string | null, number, number | null][];
  delivery: number;
  discount?: number;
  customerName?: string | null;
  /** Last 10 digits. */
  phone?: string | null;
  pincode?: string | null;
  address?: string | null;
  language?: Language;
  /** Each must appear in some missing_info note. Omit to expect none. */
  missing?: string[];
  reply?: string[];
  question?: string[];
}

const K = "Blue cotton kurti";
const A = "Pink anarkali kurti";
const D = "Printed dupatta";

export const FIXTURES: Fixture[] = [
  {
    name: "Hinglish order across several messages",
    chat: [
      "[10:02] Customer: Hi di, ye blue wali kurti available hai?",
      "[10:05] Seller: Haan ji available hai 😊",
      "[10:06] Customer: M size me 2 chahiye. Aur wo printed dupatta bhi 1 bhej do jo story me tha",
      "[10:07] Customer: Address - Neha Verma, Flat 302, Shanti Apartments, Kothrud, Pune 411038",
      "[10:07] Customer: Mera number 98765 43210",
      "[10:08] Customer: COD hai kya?",
    ].join("\n"),
    items: [
      [K, "M", 2, 799],
      [D, null, 1, 349],
    ],
    delivery: 0,
    customerName: "Neha Verma",
    phone: "9876543210",
    pincode: "411038",
    address: "Flat 302, Shanti Apartments, Kothrud, Pune 411038",
    language: "Hinglish",
    reply: ["Neha ji", "COD available nahi hai", "Dispatch within 2 days"],
  },
  {
    name: "availability question with size and address missing",
    chat: "Hi! Pink anarkali available hai? Bangalore delivery chahiye",
    items: [[A, null, 1, 1199]],
    delivery: 60,
    address: null,
    language: "Hinglish",
    missing: ["Size not chosen for Pink anarkali kurti", "Delivery address and pincode missing"],
    question: ["available hai, ₹1,199", "M ya L", "pincode"],
  },
  {
    name: "English order with ship-to address and +91 phone",
    chat: "Hi, I'd like 2 blue cotton kurtis in size L and one printed dupatta. Ship to Ananya Rao, 12 MG Road, Bengaluru 560001. Phone +91 91234 56780",
    items: [
      [K, "L", 2, 799],
      [D, null, 1, 349],
    ],
    delivery: 0,
    customerName: "Ananya Rao",
    phone: "9123456780",
    pincode: "560001",
    address: "12 MG Road, Bengaluru 560001",
    language: "English",
    reply: ["Thank you, Ananya!", "free delivery"],
  },
  {
    name: "WhatsApp export with the shop as a sender",
    chat: [
      "12/10/26, 10:02 am - Rohan Iyer: Bhaiya XL size ki blue kurti chahiye",
      "12/10/26, 10:03 am - Priya's Kurti Studio: Ji available hai",
      "12/10/26, 10:05 am - Rohan Iyer: 1 bhej do, address: 45 Park Street, Kolkata 700016",
    ].join("\n"),
    items: [[K, "XL", 1, 799]],
    delivery: 60,
    customerName: "Rohan Iyer",
    pincode: "700016",
    address: "45 Park Street, Kolkata 700016",
    language: "Hinglish",
  },
  {
    name: "two sizes of the same product in one message",
    chat: "Blue kurti M me 2 aur L me 1 chahiye. Pune 411001",
    items: [
      [K, "M", 2, 799],
      [K, "L", 1, 799],
    ],
    delivery: 0,
    pincode: "411001",
    address: "Pune 411001",
  },
  {
    name: "Hindi number words and a plural",
    chat: "do blue kurti aur teen dupatte chahiye, size M\nAddress: 14 Lake Road, Kolkata 700029",
    items: [
      [K, "M", 2, 799],
      [D, null, 3, 349],
    ],
    delivery: 0,
    pincode: "700029",
  },
  {
    name: "x2 style quantities just under the free-delivery line",
    chat: "Printed dupatta x2, blue kurti S x1\nShip to 22 Residency Road, Bengaluru 560025",
    items: [
      [D, null, 2, 349],
      [K, "S", 1, 799],
    ],
    delivery: 60,
    pincode: "560025",
  },
  {
    name: "customer cancels an item",
    chat: "2 printed dupatta bhej do\nAur ek blue kurti M\nSorry dupatta nahi chahiye",
    items: [[K, "M", 1, 799]],
    delivery: 60,
    missing: ["Delivery address and pincode missing"],
  },
  {
    name: "unclear which kurti",
    chat: "Kurti chahiye M size me\nPune 411045",
    items: [["Kurti", "M", 1, null]],
    delivery: 60,
    missing: ["Which kurti did they mean: Blue cotton kurti or Pink anarkali kurti?"],
    question: ["Blue cotton kurti ya Pink anarkali kurti"],
  },
  {
    name: "unclear kurti settled in the next message",
    chat: "Kurti chahiye M size\nPink wali\nSurat 395007",
    items: [[A, "M", 1, 1199]],
    delivery: 60,
  },
  {
    name: "seller offers a percentage discount",
    chat: [
      "Customer: 2 anarkali kurti L size",
      "Seller: Aapke liye 10% off",
      "Customer: Thik hai, address: 7 Civil Lines, Jaipur 302006",
    ].join("\n"),
    items: [[A, "L", 2, 1199]],
    delivery: 0,
    discount: 240,
    address: "7 Civil Lines, Jaipur 302006",
  },
  {
    name: "customer asks for a discount",
    chat: "1 blue kurti M, kuch discount milega?\nGurgaon 122002",
    items: [[K, "M", 1, 799]],
    delivery: 60,
    missing: ["Customer asked for a discount."],
  },
  {
    name: "shop that offers COD",
    chat: "1 dupatta, COD hai?\nNoida 201301",
    shop: { ...SHOP, policies: "COD available. Dispatch in 1 day." },
    items: [[D, null, 1, 349]],
    delivery: 60,
    reply: ["COD bhi available hai", "Dispatch in 1 day."],
  },
  {
    name: "COD question with no COD policy set",
    chat: "COD hai kya? 1 blue kurti L\nIndore 452001",
    shop: { ...SHOP, policies: "" },
    items: [[K, "L", 1, 799]],
    delivery: 60,
    missing: ["Add your COD policy"],
  },
  {
    name: "delivery-time question answered from policy",
    chat: "2 dupatta, kab tak aayega? 110001 Delhi",
    items: [[D, null, 2, 349]],
    delivery: 60,
    pincode: "110001",
    address: "110001 Delhi",
    reply: ["Dispatch within 2 days of payment"],
  },
  {
    name: "Hindi in Devanagari",
    chat: "मुझे 2 printed dupatta चाहिए। पता: 21 MG रोड, जयपुर 302001",
    items: [[D, null, 2, 349]],
    delivery: 60,
    pincode: "302001",
    address: "21 MG रोड, जयपुर 302001",
    language: "Hindi (Devanagari)",
    reply: ["धन्यवाद", "{{LINK}}"],
  },
  {
    name: "name given as 'mera naam'",
    chat: "Mera naam Kavya hai. 1 pink anarkali M chahiye. Address: B-12, Sector 18, Noida 201301",
    items: [[A, "M", 1, 1199]],
    delivery: 60,
    customerName: "Kavya",
    address: "B-12, Sector 18, Noida 201301",
  },
  {
    name: "phone written with hyphens",
    chat: "+91-98111-22233 pe call karna. 1 blue kurti XL. Lucknow 226001",
    items: [[K, "XL", 1, 799]],
    delivery: 60,
    phone: "9811122233",
    pincode: "226001",
  },
  {
    name: "size written as a word",
    chat: "medium size me 1 anarkali chahiye, Chennai 600028",
    items: [[A, "M", 1, 1199]],
    delivery: 60,
  },
  {
    name: "size the product doesn't come in",
    chat: "anarkali XL me chahiye 1\nHyderabad 500081",
    items: [[A, "XL", 1, 1199]],
    delivery: 60,
    missing: ["Size XL isn't listed for Pink anarkali kurti"],
    question: ["M ya L"],
  },
  {
    name: "misspelt product",
    chat: "duppata 2 bhej do\nPatna 800001",
    items: [[D, null, 2, 349]],
    delivery: 60,
  },
  {
    name: "address spread over several lines",
    chat: "Address:\nFlat 7, Lake View\nAndheri West, Mumbai 400053\n2 blue kurti M",
    items: [[K, "M", 2, 799]],
    delivery: 0,
    pincode: "400053",
    address: "Flat 7, Lake View, Andheri West, Mumbai 400053",
  },
  {
    name: "English number word with 'deliver to'",
    chat: "Can I get three printed dupattas? Deliver to 9 Hill Road, Bandra, Mumbai 400050",
    items: [[D, null, 3, 349]],
    delivery: 60,
    address: "9 Hill Road, Bandra, Mumbai 400050",
    language: "English",
  },
  {
    name: "seller quotes a special price",
    chat: ["Customer: 1 pink anarkali L", "Seller: Aapke liye ₹999 only", "Customer: Done. Thane 400601"].join("\n"),
    items: [[A, "L", 1, 999]],
    delivery: 60,
  },
  {
    name: "customer claims a lower price",
    chat: "Blue kurti 699 wali, 1 M size\nVadodara 390007",
    items: [[K, "M", 1, 799]],
    delivery: 60,
    missing: ["Customer mentions ₹699 for Blue cotton kurti; your catalog says ₹799"],
  },
  {
    name: "nothing from the catalog",
    chat: "Hi, kya aapke paas lehenga hai?",
    items: [],
    delivery: 0,
    missing: ["No item from your catalog was found in the chat."],
    question: ["Aap kaunsa item order karna chahenge?"],
  },
  {
    name: "Instagram-style English with name and COD question",
    chat: "hey!! need 1 pink anarkali in L and 1 dupatta pls. my name is Sara Khan. address - 3rd floor, Rose Villa, Banjara Hills, Hyderabad 500034. cod?",
    items: [
      [A, "L", 1, 1199],
      [D, null, 1, 349],
    ],
    delivery: 0,
    customerName: "Sara Khan",
    address: "3rd floor, Rose Villa, Banjara Hills, Hyderabad 500034",
    language: "English",
    reply: ["We don't offer cash on delivery"],
  },
  {
    name: "quantity in pieces",
    chat: "Printed dupatta 4 pcs\nKochi 682001",
    items: [[D, null, 4, 349]],
    delivery: 60,
  },
  {
    name: "quantity changed later ('kar do' is not 2)",
    chat: "2 blue kurti M\nActually 3 kar do\nNagpur 440010",
    items: [[K, "M", 3, 799]],
    delivery: 0,
  },
  {
    name: "seller asks for the address",
    chat: ["Customer: 1 blue kurti L", "Me: Done! Address bhejiye", "Customer: Gomti Nagar, Lucknow 226010"].join("\n"),
    items: [[K, "L", 1, 799]],
    delivery: 60,
    address: "Gomti Nagar, Lucknow 226010",
  },
  // Written after the reader was built; all passed on the first run.
  {
    name: "unseen: 'pata' address, name at the end, two sizes",
    chat: "Hello, mujhe 3 blue kurti chahiye - 2 M aur 1 L. Pata: 5, Shivaji Nagar, Pune 411005. Mera naam Rahul Sharma.",
    items: [
      [K, "M", 2, 799],
      [K, "L", 1, 799],
    ],
    delivery: 0,
    customerName: "Rahul Sharma",
    pincode: "411005",
    address: "5, Shivaji Nagar, Pune 411005",
  },
  {
    name: "unseen: 'size M x 2' and 'also a dupatta'",
    chat: "Need pink anarkali size M x 2. Also a dupatta. Address: 22B, Park Avenue, Kolkata 700017",
    items: [
      [A, "M", 2, 1199],
      [D, null, 1, 349],
    ],
    delivery: 0,
    address: "22B, Park Avenue, Kolkata 700017",
    language: "English",
  },
  {
    name: "unseen: unclear kurti settled by colour, size still missing",
    chat: "bhaiya 1 dupatta aur 1 kurti chahiye\nblue wali\n452010",
    items: [
      [D, null, 1, 349],
      [K, null, 1, 799],
    ],
    delivery: 60,
    pincode: "452010",
    missing: ["Size not chosen for Blue cotton kurti"],
  },
  {
    name: "unseen: 'the blue one in large? 2 pieces'",
    chat: "Can you send the blue one in large? 2 pieces. 560034",
    items: [[K, "L", 2, 799]],
    delivery: 0,
    language: "English",
  },
  {
    name: "unseen: same product in two sizes on separate lines",
    chat: "1 blue kurti XL\n1 blue kurti L\nDelhi 110092",
    items: [
      [K, "XL", 1, 799],
      [K, "L", 1, 799],
    ],
    delivery: 0,
  },
  {
    name: "unseen: price question answered by the seller",
    chat: [
      "Customer: kitne ka hai anarkali?",
      "Seller: 1199 ka hai ji",
      "Customer: ok 1 M size bhej do. 380015 Ahmedabad",
    ].join("\n"),
    items: [[A, "M", 1, 1199]],
    delivery: 60,
    pincode: "380015",
  },
  {
    name: "unseen: 'aur kuch nahi chahiye' is not a cancellation",
    chat: "Didi 2 dupatte bhejna, aur kuch nahi chahiye. Address - Sneha Patil, 12 Gandhi Road, Nashik 422001",
    items: [[D, null, 2, 349]],
    delivery: 60,
    customerName: "Sneha Patil",
    address: "12 Gandhi Road, Nashik 422001",
  },
  {
    name: "unseen: sizes as words with 'one each'",
    chat: "hi i want blue kurti medium and pink anarkali large, one each. my address is 44 Rose Garden, Chandigarh 160017",
    items: [
      [K, "M", 1, 799],
      [A, "L", 1, 1199],
    ],
    delivery: 0,
    address: "44 Rose Garden, Chandigarh 160017",
  },
  {
    name: "batch 3: house number is not a quantity, 'send to' starts the address",
    chat: "Hi, do you have the pink anarkali? I want one in XL. Also is COD available? Send to Rohan Mehta, 14 Park Street, Kolkata",
    items: [[A, "XL", 1, 1199]],
    delivery: 60,
    customerName: "Rohan Mehta",
    address: "14 Park Street, Kolkata",
    language: "English",
    missing: ["Size XL isn't listed", "Pincode missing"],
  },
  {
    name: "batch 3: quantity after 'chahiye', address and phone on their own lines",
    chat: "hello\nblue kurti L size chahiye 3\nprice kya hai?\naddress: 45 MG Road, Indiranagar, Bengaluru 560038\nphone 9123456789",
    items: [[K, "L", 3, 799]],
    delivery: 0,
    phone: "9123456789",
    address: "45 MG Road, Indiranagar, Bengaluru 560038",
    language: "Hinglish",
  },
  {
    name: "batch 3: WhatsApp export with the shop's own messages",
    chat: [
      "[3/11/26, 9:14 PM] Anjali: hii",
      "[3/11/26, 9:15 PM] Anjali: dupatta 2 chahiye",
      "[3/11/26, 9:15 PM] Anjali: aur ek blue kurti M",
      "[3/11/26, 9:16 PM] Priya's Kurti Studio: done ji",
      "[3/11/26, 9:17 PM] Anjali: Anjali Singh, B-12 Lajpat Nagar, New Delhi 110024. 9988776655",
    ].join("\n"),
    items: [
      [D, null, 2, 349],
      [K, "M", 1, 799],
    ],
    delivery: 60,
    customerName: "Anjali Singh",
    phone: "9988776655",
    address: "B-12 Lajpat Nagar, New Delhi 110024",
  },
  {
    name: "batch 3: 'one S and one M'",
    chat: "Can I get 2 blue kurtis, one S and one M? Deliver to Kavya Rao, 7th Cross, Jayanagar, Bengaluru 560011. Number is 9876501234",
    items: [
      [K, "S", 1, 799],
      [K, "M", 1, 799],
    ],
    delivery: 0,
    customerName: "Kavya Rao",
    phone: "9876501234",
    pincode: "560011",
  },
  {
    name: "batch 3: Devanagari product words",
    chat: "नमस्ते, मुझे नीली कुर्ती चाहिए M साइज़ में। पता: 21 शिवाजी नगर, पुणे 411005",
    items: [[K, "M", 1, 799]],
    delivery: 60,
    pincode: "411005",
    language: "Hindi (Devanagari)",
  },
  {
    name: "batch 3: size asked for, then 'book 1'",
    chat: [
      "Customer: Is the anarkali available in L?",
      "Seller: Yes ma'am, ₹1,199",
      "Customer: ok book 1. Also 2 dupattas",
      "Customer: my name is Sneha Iyer, ph 9000012345",
      "Customer: address 3rd floor, Sai Residency, Anna Nagar, Chennai 600040",
    ].join("\n"),
    items: [
      [A, "L", 1, 1199],
      [D, null, 2, 349],
    ],
    delivery: 0,
    customerName: "Sneha Iyer",
    phone: "9000012345",
    pincode: "600040",
  },
  {
    name: "batch 3: one-word name before the address, cancelled dupatta",
    chat: "pink wali M me de do aur blue wali bhi M me. dupatta nahi chahiye. Ritu, house no 55, sector 21, Gurugram 122016, 98100 22334",
    items: [
      [A, "M", 1, 1199],
      [K, "M", 1, 799],
    ],
    delivery: 0,
    customerName: "Ritu",
    phone: "9810022334",
    address: "house no 55, sector 21, Gurugram 122016",
  },
  {
    name: "batch 3: 'quantity 2' and a discount request",
    chat: "Hi! I'd like the blue cotton kurti in XL, quantity 2. Can you give a discount? Ship to Meera Nair, Flat 9B, Marine Drive, Kochi 682031.",
    items: [[K, "XL", 2, 799]],
    delivery: 0,
    customerName: "Meera Nair",
    address: "Flat 9B, Marine Drive, Kochi 682031",
    missing: ["discount"],
  },
];
