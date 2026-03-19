# Rooftop Solar Assessor Backend

## Overview
The Rooftop Solar Assessor backend is designed to support the frontend application by providing APIs for solar assessment functionalities. It handles requests related to solar data retrieval and processing, enabling users to estimate solar energy generation based on their rooftop specifications.

## Features
- **Solar Assessment**: Calculate potential solar energy generation based on user-defined rooftop areas.
- **Irradiance Data**: Fetch solar irradiance data from reliable sources to provide accurate estimates.
- **RESTful API**: Expose endpoints for frontend integration, allowing seamless communication between the client and server.

## Installation
1. Clone the repository:
   ```
   git clone <repository-url>
   ```
2. Navigate to the backend directory:
   ```
   cd rooftop-solar-assessor/backend
   ```
3. Install dependencies:
   ```
   npm install
   ```

## Usage
To start the backend server, run:
```
npm start
```
The server will be available at `http://localhost:3000` (or the specified port in your configuration).

## API Endpoints
- **GET /api/solar**: Fetch solar data for a specified location.
- **POST /api/solar/assess**: Submit rooftop area details for solar assessment.

## Contributing
Contributions are welcome! Please submit a pull request or open an issue for any enhancements or bug fixes.

## License
This project is licensed under the MIT License. See the LICENSE file for details.