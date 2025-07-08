#!/usr/bin/env python3
"""
Comparison test script for Node.js vs Python Lambda functions
This script helps validate that Python functions produce equivalent results to Node.js functions
"""

import json
import requests
import time
from typing import Dict, Any, List
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor

@dataclass
class ApiEndpoint:
    name: str
    nodejs_url: str
    python_url: str
    method: str = 'GET'
    payload: Dict[str, Any] = None

class FunctionComparison:
    def __init__(self, nodejs_base_url: str, python_base_url: str):
        self.nodejs_base_url = nodejs_base_url.rstrip('/')
        self.python_base_url = python_base_url.rstrip('/')
        
        # Define endpoints to compare
        self.endpoints = [
            ApiEndpoint(
                name="List Distributions",
                nodejs_url=f"{self.nodejs_base_url}/distributions",
                python_url=f"{self.python_base_url}/distributions"
            ),
            ApiEndpoint(
                name="List Templates", 
                nodejs_url=f"{self.nodejs_base_url}/templates",
                python_url=f"{self.python_base_url}/templates"
            ),
            ApiEndpoint(
                name="List Origins",
                nodejs_url=f"{self.nodejs_base_url}/origins", 
                python_url=f"{self.python_base_url}/origins"
            ),
            ApiEndpoint(
                name="List Certificates",
                nodejs_url=f"{self.nodejs_base_url}/certificates",
                python_url=f"{self.python_base_url}/certificates"
            ),
        ]
    
    def make_request(self, url: str, method: str = 'GET', payload: Dict[str, Any] = None) -> Dict[str, Any]:
        """Make HTTP request and return response data"""
        try:
            start_time = time.time()
            
            if method.upper() == 'GET':
                response = requests.get(url, timeout=30)
            elif method.upper() == 'POST':
                response = requests.post(url, json=payload, timeout=30)
            else:
                raise ValueError(f"Unsupported method: {method}")
            
            end_time = time.time()
            
            return {
                'status_code': response.status_code,
                'response_time': end_time - start_time,
                'data': response.json() if response.content else {},
                'error': None
            }
        except Exception as error:
            return {
                'status_code': None,
                'response_time': None,
                'data': {},
                'error': str(error)
            }
    
    def compare_responses(self, nodejs_result: Dict[str, Any], python_result: Dict[str, Any]) -> Dict[str, Any]:
        """Compare two API responses"""
        comparison = {
            'status_match': nodejs_result['status_code'] == python_result['status_code'],
            'both_successful': (
                nodejs_result['status_code'] == 200 and 
                python_result['status_code'] == 200
            ),
            'nodejs_faster': False,
            'python_faster': False,
            'data_structure_match': False,
            'data_count_match': False,
            'issues': []
        }
        
        # Compare response times
        if nodejs_result['response_time'] and python_result['response_time']:
            if nodejs_result['response_time'] < python_result['response_time']:
                comparison['nodejs_faster'] = True
            else:
                comparison['python_faster'] = True
        
        # Compare data structure if both successful
        if comparison['both_successful']:
            nodejs_data = nodejs_result['data']
            python_data = python_result['data']
            
            # Check if both have success field
            if nodejs_data.get('success') == python_data.get('success'):
                comparison['data_structure_match'] = True
            
            # Check data counts for list endpoints
            nodejs_items = self.get_item_count(nodejs_data)
            python_items = self.get_item_count(python_data)
            
            if nodejs_items is not None and python_items is not None:
                comparison['data_count_match'] = nodejs_items == python_items
                if not comparison['data_count_match']:
                    comparison['issues'].append(
                        f"Item count mismatch: Node.js={nodejs_items}, Python={python_items}"
                    )
        
        # Check for errors
        if nodejs_result['error']:
            comparison['issues'].append(f"Node.js error: {nodejs_result['error']}")
        
        if python_result['error']:
            comparison['issues'].append(f"Python error: {python_result['error']}")
        
        return comparison
    
    def get_item_count(self, data: Dict[str, Any]) -> int:
        """Extract item count from API response"""
        if not isinstance(data, dict):
            return None
        
        # Check common patterns
        data_section = data.get('data', {})
        
        # For distributions, templates, origins, certificates
        for key in ['distributions', 'templates', 'origins', 'certificates']:
            if key in data_section:
                items = data_section[key]
                return len(items) if isinstance(items, list) else None
        
        return None
    
    def test_endpoint(self, endpoint: ApiEndpoint) -> Dict[str, Any]:
        """Test a single endpoint comparison"""
        print(f"Testing {endpoint.name}...")
        
        # Make requests to both endpoints
        with ThreadPoolExecutor(max_workers=2) as executor:
            nodejs_future = executor.submit(
                self.make_request, endpoint.nodejs_url, endpoint.method, endpoint.payload
            )
            python_future = executor.submit(
                self.make_request, endpoint.python_url, endpoint.method, endpoint.payload
            )
            
            nodejs_result = nodejs_future.result()
            python_result = python_future.result()
        
        # Compare results
        comparison = self.compare_responses(nodejs_result, python_result)
        
        return {
            'endpoint': endpoint.name,
            'nodejs_result': nodejs_result,
            'python_result': python_result,
            'comparison': comparison
        }
    
    def run_all_tests(self) -> Dict[str, Any]:
        """Run all endpoint comparisons"""
        print("Starting CloudFront Manager API Comparison Tests")
        print("=" * 60)
        
        results = []
        
        for endpoint in self.endpoints:
            try:
                result = self.test_endpoint(endpoint)
                results.append(result)
                
                # Print summary
                comp = result['comparison']
                status = "✅ PASS" if comp['both_successful'] and comp['data_structure_match'] else "❌ FAIL"
                print(f"{status} {endpoint.name}")
                
                if comp['issues']:
                    for issue in comp['issues']:
                        print(f"  ⚠️  {issue}")
                
                # Performance comparison
                nodejs_time = result['nodejs_result']['response_time']
                python_time = result['python_result']['response_time']
                
                if nodejs_time and python_time:
                    faster = "Node.js" if comp['nodejs_faster'] else "Python"
                    print(f"  🏃 {faster} faster ({nodejs_time:.3f}s vs {python_time:.3f}s)")
                
                print()
                
            except Exception as error:
                print(f"❌ ERROR testing {endpoint.name}: {error}")
                results.append({
                    'endpoint': endpoint.name,
                    'error': str(error)
                })
        
        # Generate summary
        successful_tests = sum(1 for r in results if r.get('comparison', {}).get('both_successful', False))
        total_tests = len(results)
        
        print("=" * 60)
        print(f"SUMMARY: {successful_tests}/{total_tests} tests passed")
        
        return {
            'summary': {
                'total_tests': total_tests,
                'successful_tests': successful_tests,
                'pass_rate': successful_tests / total_tests if total_tests > 0 else 0
            },
            'results': results
        }

def main():
    """Main function to run comparison tests"""
    # Configuration - update these URLs with your actual API endpoints
    NODEJS_API_URL = "https://your-nodejs-api-id.execute-api.region.amazonaws.com/api"
    PYTHON_API_URL = "https://your-python-api-id.execute-api.region.amazonaws.com/prod"
    
    # Check if URLs are configured
    if "your-" in NODEJS_API_URL or "your-" in PYTHON_API_URL:
        print("❌ Please update the API URLs in the script before running tests")
        print(f"Node.js API URL: {NODEJS_API_URL}")
        print(f"Python API URL: {PYTHON_API_URL}")
        return
    
    # Run comparison tests
    comparison = FunctionComparison(NODEJS_API_URL, PYTHON_API_URL)
    results = comparison.run_all_tests()
    
    # Save detailed results
    with open('comparison_results.json', 'w') as f:
        json.dump(results, f, indent=2, default=str)
    
    print(f"Detailed results saved to comparison_results.json")
    
    # Exit with appropriate code
    if results['summary']['pass_rate'] == 1.0:
        print("🎉 All tests passed!")
        exit(0)
    else:
        print("⚠️  Some tests failed. Check the results above.")
        exit(1)

if __name__ == "__main__":
    main()

"""
Usage:
1. Update the API URLs in the main() function
2. Install dependencies: pip install requests
3. Run the script: python test_comparison.py

The script will:
- Test each endpoint with both Node.js and Python implementations
- Compare response times, status codes, and data structure
- Generate a detailed comparison report
- Save results to comparison_results.json

Example output:
✅ PASS List Distributions
  🏃 Python faster (0.245s vs 0.312s)

✅ PASS List Templates  
  🏃 Node.js faster (0.156s vs 0.203s)

❌ FAIL List Origins
  ⚠️  Item count mismatch: Node.js=5, Python=3

SUMMARY: 2/3 tests passed
"""
