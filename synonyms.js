/* ============================================================
   SMARTFORM — FIELD ANALYZER
   Canonical Fields | Synonyms | Metadata | Form Detection
   ============================================================ */

(() => {
  'use strict';

  const FA = globalThis.FA || (globalThis.FA = {});

  /* ==========================================================
     1. CANONICAL PROFILE FIELDS
     ========================================================== */

  FA.CANON = [

    // --------------------------------------------------------
    // PERSONAL IDENTITY
    // --------------------------------------------------------

    {
      key: 'salutation',
      label: 'Title (Mr / Ms)',
      syn: ['salutation', 'prefix', 'mr ms mrs', 'honorific', 'name title', 'title mr ms']
    },
    {
      key: 'firstName',
      label: 'First name',
      ac: ['given-name'],
      syn: ['first name', 'given name', 'forename', 'fname', 'first', 'christian name', 'name first', 'prenom', 'vorname', 'primer nombre']
    },
    {
      key: 'middleName',
      label: 'Middle name',
      ac: ['additional-name'],
      syn: ['middle name', 'middle initial', 'mname', 'second given name']
    },
    {
      key: 'lastName',
      label: 'Last name',
      ac: ['family-name'],
      syn: ['last name', 'surname', 'family name', 'lname', 'last', 'name last', 'nom de famille', 'nachname', 'apellido']
    },
    {
      key: 'fullName',
      label: 'Full name',
      ac: ['name'],
      syn: ['full name', 'name', 'your name', 'complete name', 'applicant name', 'candidate name', 'name of applicant', 'contact name', 'person name', 'customer name', 'student name', 'participant name', 'legal name', 'nombre completo']
    },
    {
      key: 'gender',
      label: 'Gender',
      ac: ['sex'],
      syn: ['gender', 'sex', 'male female', 'm f']
    },
    {
      key: 'dob',
      label: 'Date of birth (YYYY-MM-DD)',
      ac: ['bday'],
      types: ['date'],
      strong: ['birthday', 'birthdate', 'dob'],
      syn: ['date of birth', 'birth date', 'birthday', 'dob', 'born on', 'd o b', 'geburtsdatum', 'fecha de nacimiento']
    },
    {
      key: 'age',
      label: 'Age',
      syn: ['age', 'your age', 'age years']
    },
    {
      key: 'nationality',
      label: 'Nationality',
      syn: ['nationality', 'citizenship', 'citizen of']
    },
    {
      key: 'maritalStatus',
      label: 'Marital status',
      syn: ['marital status', 'civil status', 'relationship status', 'married']
    },
    {
      key: 'religion',
      label: 'Religion',
      syn: ['religion', 'faith']
    },
    {
      key: 'language',
      label: 'Language',
      syn: ['language', 'mother tongue', 'native language', 'languages known', 'languages spoken', 'preferred language']
    },
    {
      key: 'bloodGroup',
      label: 'Blood group',
      syn: ['blood group', 'blood type', 'bloodgroup']
    },

    // --------------------------------------------------------
    // FAMILY DETAILS
    // --------------------------------------------------------

    {
      key: 'fatherName',
      label: "Father's name",
      syn: ['father name', 'name of father', 'fathers name', 'guardian name', 'parent name', 'parent guardian name']
    },
    {
      key: 'motherName',
      label: "Mother's name",
      syn: ['mother name', 'name of mother', 'mothers name']
    },

    // --------------------------------------------------------
    // CONTACT DETAILS
    // --------------------------------------------------------

    {
      key: 'email',
      label: 'Email',
      ac: ['email'],
      types: ['email'],
      strong: ['email'],
      syn: ['email', 'email address', 'mail', 'email id', 'mail id', 'electronic mail', 'work email', 'business email', 'official email', 'correo electronico', 'courriel']
    },
    {
      key: 'phone',
      label: 'Phone',
      ac: ['tel', 'tel-national'],
      types: ['tel'],
      strong: ['phone', 'mobile', 'telephone', 'cell', 'whatsapp', 'tel'],
      syn: ['phone', 'phone number', 'mobile', 'mobile number', 'cell', 'cell phone', 'contact number', 'telephone', 'tel', 'contact no', 'whatsapp number', 'mobile no', 'phone no', 'telefono']
    },
    {
      key: 'website',
      label: 'Website',
      ac: ['url'],
      types: ['url'],
      strong: ['website', 'url', 'homepage'],
      syn: ['website', 'web site', 'url', 'homepage', 'web address', 'portfolio', 'personal website', 'site web']
    },
    {
      key: 'linkedin',
      label: 'LinkedIn',
      strong: ['linkedin'],
      syn: ['linkedin', 'linkedin url', 'linkedin profile', 'linkedin profile url']
    },
    {
      key: 'github',
      label: 'GitHub',
      strong: ['github'],
      syn: ['github', 'github url', 'github profile', 'github username']
    },
    {
      key: 'username',
      label: 'Username',
      ac: ['username'],
      syn: ['username', 'user name', 'user id', 'login', 'handle', 'screen name']
    },

    // --------------------------------------------------------
    // ADDRESS DETAILS
    // --------------------------------------------------------

    {
      key: 'address1',
      label: 'Address',
      ac: ['address-line1', 'street-address'],
      syn: ['address', 'street address', 'address line 1', 'address 1', 'street', 'addr', 'mailing address', 'residential address', 'home address', 'current address']
    },
    {
      key: 'address2',
      label: 'Address line 2',
      ac: ['address-line2'],
      syn: ['address line 2', 'address 2', 'apartment', 'apt', 'suite', 'unit', 'flat', 'apartment suite', 'street address 2', 'landmark']
    },
    {
      key: 'city',
      label: 'City',
      ac: ['address-level2'],
      strong: ['city', 'town'],
      syn: ['city', 'town', 'city town', 'municipality', 'ville', 'ciudad', 'stadt', 'shehar']
    },
    {
      key: 'state',
      label: 'State / Province',
      ac: ['address-level1'],
      syn: ['state', 'province', 'region', 'state province', 'state region', 'county', 'territory', 'estado']
    },
    {
      key: 'zip',
      label: 'Postal code',
      ac: ['postal-code'],
      strong: ['zip', 'postcode', 'postal', 'pincode'],
      syn: ['zip', 'zip code', 'postal code', 'postcode', 'pin code', 'pincode', 'post code', 'plz', 'codigo postal']
    },
    {
      key: 'country',
      label: 'Country',
      ac: ['country', 'country-name'],
      strong: ['country'],
      syn: ['country', 'country region', 'nation', 'pais', 'pays', 'land']
    },

    // --------------------------------------------------------
    // IDENTITY DOCUMENTS
    // --------------------------------------------------------

    {
      key: 'idNumber',
      label: 'National ID number',
      syn: ['id number', 'national id', 'national id number', 'cnic', 'cnic number', 'nic', 'ssn', 'social security number', 'identity number', 'id card number', 'aadhaar', 'aadhar', 'tax id', 'citizen id']
    },
    {
      key: 'passport',
      label: 'Passport number',
      strong: ['passport'],
      syn: ['passport', 'passport number', 'passport no']
    },

    // --------------------------------------------------------
    // WORK AND EDUCATION
    // --------------------------------------------------------

    {
      key: 'company',
      label: 'Company',
      ac: ['organization'],
      strong: ['company', 'organization', 'organisation', 'employer'],
      syn: ['company', 'company name', 'organization', 'organisation', 'employer', 'business name', 'current company', 'current employer', 'workplace', 'firm']
    },
    {
      key: 'jobTitle',
      label: 'Job title',
      ac: ['organization-title'],
      syn: ['job title', 'position', 'designation', 'role', 'occupation', 'profession', 'current position', 'current role', 'job role', 'professional title']
    },
    {
      key: 'experience',
      label: 'Years of experience',
      syn: ['experience', 'years of experience', 'work experience', 'total experience', 'experience years']
    },
    {
      key: 'salary',
      label: 'Expected salary',
      syn: ['salary', 'expected salary', 'current salary', 'desired salary', 'expected ctc', 'current ctc', 'compensation']
    },
    {
      key: 'education',
      label: 'Highest education',
      syn: ['education', 'highest education', 'qualification', 'highest qualification', 'degree', 'level of education', 'education level']
    },
    {
      key: 'university',
      label: 'University / school',
      syn: ['university', 'college', 'school', 'institution', 'institute', 'school name', 'university name', 'college name']
    },

    // --------------------------------------------------------
    // DECLARATIONS
    // --------------------------------------------------------

    {
      key: 'agree',
      label: 'Agree to terms',
      strong: ['agree', 'consent', 'declaration'],
      syn: ['i agree', 'agree to terms', 'terms and conditions', 'accept terms', 'i accept', 'consent', 'declaration', 'i hereby declare', 'privacy policy', 'terms of service']
    }
  ];


  /* ==========================================================
     2. PHOTO UPLOAD DETECTION
     ========================================================== */

  FA.PHOTO = {
    strong: [
      'photo',
      'photograph',
      'picture',
      'headshot',
      'avatar',
      'selfie'
    ],

    syn: [
      'photo',
      'passport size photo',
      'passport photo',
      'passport size picture',
      'photograph',
      'picture',
      'profile picture',
      'profile photo',
      'profile image',
      'profile pic',
      'image',
      'your photo',
      'recent photograph',
      'recent photo',
      'applicant photo',
      'candidate photo',
      'photo upload',
      'pic',
      'student photo',
      'id photo',
      'face photo',
      'passport size photograph'
    ]
  };


  /* ==========================================================
     3. PROFILE FIELD GROUPS
     ========================================================== */

  FA.GROUPS = [
    { id: 'identity', title: 'Personal details' },
    { id: 'family', title: 'Family' },
    { id: 'contact', title: 'Contact' },
    { id: 'address', title: 'Address' },
    { id: 'documents', title: 'Identity documents' },
    { id: 'work', title: 'Work and education' },
    { id: 'other', title: 'Declarations' }
  ];


  /* ==========================================================
     4. FIELD METADATA
     Controls profile form input types, options and hints.
     ========================================================== */

  FA.META = {

    // Personal identity
    salutation: {
      group: 'identity',
      input: 'select',
      options: ['Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Prof']
    },

    firstName: { group: 'identity' },
    middleName: { group: 'identity' },
    lastName: { group: 'identity' },

    fullName: {
      group: 'identity',
      hint: 'Leave empty to join first and last name automatically'
    },

    gender: {
      group: 'identity',
      input: 'select',
      options: ['Male', 'Female', 'Other']
    },

    dob: {
      group: 'identity',
      input: 'date'
    },

    age: {
      group: 'identity',
      input: 'number'
    },

    nationality: { group: 'identity' },

    maritalStatus: {
      group: 'identity',
      input: 'select',
      options: ['Single', 'Married', 'Divorced', 'Widowed']
    },

    religion: { group: 'identity' },
    language: { group: 'identity' },

    bloodGroup: {
      group: 'identity',
      input: 'select',
      options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
    },

    // Family
    fatherName: { group: 'family' },
    motherName: { group: 'family' },

    // Contact
    email: { group: 'contact', input: 'email' },
    phone: { group: 'contact', input: 'tel' },
    website: { group: 'contact', input: 'url' },
    linkedin: { group: 'contact', input: 'url' },
    github: { group: 'contact', input: 'url' },
    username: { group: 'contact' },

    // Address
    address1: { group: 'address' },
    address2: { group: 'address' },
    city: { group: 'address' },
    state: { group: 'address' },
    zip: { group: 'address' },
    country: { group: 'address' },

    // Documents
    idNumber: { group: 'documents' },
    passport: { group: 'documents' },

    // Work and education
    company: { group: 'work' },
    jobTitle: { group: 'work' },
    salary: { group: 'work' },
    experience: { group: 'work' },
    education: { group: 'work' },
    university: { group: 'work' },

    // Declarations
    agree: {
      group: 'other',
      input: 'select',
      options: ['Yes'],
      hint: 'Ticks "I agree" / declaration boxes when set to Yes'
    }
  };


  /* ==========================================================
     5. FORM TYPE DETECTION
     Identifies the purpose of a website form using its title.
     ========================================================== */

  FA.FORM_TYPES = {

    job: {
      words: [
        'job', 'career', 'careers', 'apply',
        'application', 'vacancy', 'position',
        'recruitment', 'hiring', 'candidate',
        'resume', 'cv', 'employment'
      ],
      boost: [
        'company', 'jobTitle', 'linkedin',
        'github', 'experience', 'salary',
        'education', 'university'
      ]
    },

    student: {
      words: [
        'admission', 'student', 'enrol',
        'enroll', 'enrollment', 'school',
        'college', 'university', 'course',
        'scholarship', 'exam'
      ],
      boost: [
        'education', 'university', 'dob',
        'nationality', 'idNumber',
        'fatherName', 'motherName'
      ]
    },

    contact: {
      words: [
        'contact', 'enquiry', 'inquiry',
        'support', 'feedback', 'message',
        'get in touch', 'quote'
      ],
      boost: ['fullName', 'email', 'phone']
    },

    checkout: {
      words: [
        'checkout', 'shipping', 'billing',
        'delivery', 'order', 'address'
      ],
      boost: [
        'address1', 'address2', 'city',
        'state', 'zip', 'country', 'phone'
      ]
    },

    register: {
      words: [
        'register', 'registration', 'sign up',
        'signup', 'create account', 'join',
        'membership', 'subscribe'
      ],
      boost: [
        'username', 'email',
        'firstName', 'lastName'
      ]
    },

    kyc: {
      words: [
        'kyc', 'verification', 'identity',
        'bank', 'account opening', 'tax'
      ],
      boost: [
        'idNumber', 'passport',
        'dob', 'nationality', 'address1'
      ]
    }
  };


  /* ==========================================================
     6. DEFAULT PROFILE GENERATOR
     Creates an empty profile containing every canonical field.
     ========================================================== */

  FA.defaultProfile = function () {

    return {
      name: 'Personal',
      keywords: [],
      photo: null,

      fields: FA.CANON.map(field => ({
        key: field.key,
        label: field.label,
        value: '',
        synonyms: []
      }))
    };

  };


  /* ==========================================================
     7. FIELD LOOKUP UTILITIES
     Useful for other FormPilot scripts.
     ========================================================== */

  FA.getField = function (key) {
    return FA.CANON.find(field => field.key === key) || null;
  };

  FA.getFieldMeta = function (key) {
    return FA.META[key] || {};
  };

  FA.getGroup = function (groupId) {
    return FA.GROUPS.find(group => group.id === groupId) || null;
  };

  FA.getFieldsByGroup = function (groupId) {
    return FA.CANON.filter(field =>
      FA.META[field.key]?.group === groupId
    );
  };

  FA.getAllFieldKeys = function () {
    return FA.CANON.map(field => field.key);
  };


  /* ==========================================================
     8. INITIALIZATION
     ========================================================== */

  FA.version = '1.0.0';
  FA.initialized = true;

  console.info('[FormPilot] Field Analyzer initialized.');

})();
